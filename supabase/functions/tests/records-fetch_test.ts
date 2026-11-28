import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import type { LookupAddress } from "node:dns";
import {
  assertAddressGuard,
  isPublicAddress,
  RefusedAddressError,
  safeFetch,
  type SocketConn,
  socketFetch,
  type Sockets,
} from "../_shared/records-fetch.ts";

interface Fake {
  sockets: Sockets;
  resolved: string[];
  connected: [string, number][];
  tlsNames: string[];
  sent: () => string;
  closed: () => boolean;
}

// Answers arrive a few bytes at a time unless `step` says otherwise, so framing is read across reads.
function fakeSockets(
  addresses: LookupAddress[] | (() => LookupAddress[]),
  answer: string | Uint8Array = "",
  step = 7,
): Fake {
  const resolved: string[] = [];
  const connected: [string, number][] = [];
  const tlsNames: string[] = [];
  let written = "";
  let closed = false;
  let rest = typeof answer === "string" ? new TextEncoder().encode(answer) : answer;
  const conn: SocketConn = {
    read(p) {
      if (closed) return Promise.reject(new Error("closed"));
      if (rest.length === 0) return Promise.resolve(null);
      const n = Math.min(p.length, rest.length, step);
      p.set(rest.subarray(0, n));
      rest = rest.subarray(n);
      return Promise.resolve(n);
    },
    write(p) {
      written += new TextDecoder().decode(p);
      return Promise.resolve(p.length);
    },
    close() {
      closed = true;
    },
  };
  return {
    sockets: {
      resolve(hostname) {
        resolved.push(hostname);
        return Promise.resolve(typeof addresses === "function" ? addresses() : addresses);
      },
      connect(address, port) {
        connected.push([address, port]);
        return Promise.resolve(conn);
      },
      startTls(_conn, hostname) {
        tlsNames.push(hostname);
        return Promise.resolve(conn);
      },
    },
    resolved,
    connected,
    tlsNames,
    sent: () => written,
    closed: () => closed,
  };
}

const PUBLIC: LookupAddress[] = [{ address: "93.184.215.14", family: 4 }];
const OK = "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: 11\r\n\r\n{\"ok\":true}";

Deno.test("loopback, private, reserved and IPv4-mapped private addresses aren't public", () => {
  for (const address of [
    "127.0.0.1",
    "::1",
    "0.0.0.0",
    "10.0.0.5",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "::",
    "::ffff:10.0.0.5",
    "::ffff:127.0.0.1",
    "::FFFF:192.168.1.1",
    "2001:db8::1",
    "not an address",
  ]) {
    assertEquals(isPublicAddress(address), false, address);
  }
});

Deno.test("public IPv4, IPv6 and IPv4-mapped public addresses are public", () => {
  for (const address of ["8.8.8.8", "2606:4700::1111", "::ffff:8.8.8.8"]) {
    assertEquals(isPublicAddress(address), true, address);
  }
});

Deno.test("a host that resolves to a private address is refused before connecting", async () => {
  for (const addresses of [
    [{ address: "10.0.0.5", family: 4 }],
    [{ address: "127.0.0.1", family: 4 }],
    [{ address: "::1", family: 6 }],
    [{ address: "::ffff:192.168.1.1", family: 6 }],
    [...PUBLIC, { address: "192.168.1.1", family: 4 }],
    [],
  ]) {
    const fake = fakeSockets(addresses, OK);
    await assertRejects(() => socketFetch(fake.sockets)("https://rock.example.org/api"), RefusedAddressError);
    assertEquals(fake.connected, []);
  }
});

Deno.test("an address literal that isn't public is refused without resolving", async () => {
  for (const url of ["https://127.0.0.1/", "https://10.0.0.5/", "https://[::1]/", "https://[::ffff:10.0.0.5]/"]) {
    const fake = fakeSockets(PUBLIC, OK);
    await assertRejects(() => socketFetch(fake.sockets)(url), RefusedAddressError);
    await assertRejects(() => safeFetch(url), RefusedAddressError);
    assertEquals(fake.resolved, []);
  }
});

Deno.test("a public host is reached at the address that was checked, with its name for TLS and Host", async () => {
  const fake = fakeSockets(
    [{ address: "2606:4700::1111", family: 6 }, ...PUBLIC],
    OK,
  );
  const response = await socketFetch(fake.sockets)("https://rock.example.org/api/People?$top=1", {
    headers: { "Authorization-Token": "key" },
  });
  assertEquals(response.status, 200);
  assertEquals(response.headers.get("content-type"), "application/json");
  assertEquals(await response.json(), { ok: true });
  assertEquals(fake.connected, [["93.184.215.14", 443]]);
  assertEquals(fake.tlsNames, ["rock.example.org"]);
  const sent = fake.sent();
  assert(sent.startsWith("GET /api/People?$top=1 HTTP/1.1\r\nhost: rock.example.org\r\n"), sent);
  assert(sent.includes("\r\nauthorization-token: key\r\n"), sent);
  assert(sent.includes("\r\naccept-encoding: identity\r\n"), sent);
  assert(sent.endsWith("\r\nconnection: close\r\n\r\n"), sent);
  assert(fake.closed());
});

Deno.test("a POST is sent with an empty body", async () => {
  const fake = fakeSockets(PUBLIC, "HTTP/1.1 201 Created\r\ncontent-length: 0\r\n\r\n");
  const response = await socketFetch(fake.sockets)("https://rock.example.org:8443/api/People", { method: "POST" });
  assertEquals(response.status, 201);
  assertEquals(fake.connected, [["93.184.215.14", 8443]]);
  const sent = fake.sent();
  assert(sent.startsWith("POST /api/People HTTP/1.1\r\nhost: rock.example.org:8443\r\n"), sent);
  assert(sent.includes("\r\ncontent-length: 0\r\n"), sent);
});

Deno.test("the name is resolved once, so a rebinding answer is never connected to", async () => {
  let calls = 0;
  const fake = fakeSockets(() => (calls++ === 0 ? PUBLIC : [{ address: "127.0.0.1", family: 4 }]), OK);
  await socketFetch(fake.sockets)("https://rock.example.org/");
  assertEquals(fake.resolved, ["rock.example.org"]);
  assertEquals(fake.connected, [["93.184.215.14", 443]]);
});

Deno.test("a chunked body is decoded and an interim answer skipped", async () => {
  const fake = fakeSockets(
    PUBLIC,
    "HTTP/1.1 100 Continue\r\n\r\nHTTP/1.1 200 OK\r\ntransfer-encoding: chunked\r\n\r\n4;x=y\r\nWiki\r\n5\r\npedia\r\n0\r\n\r\n",
  );
  const response = await socketFetch(fake.sockets)("https://rock.example.org/");
  assertEquals(await response.text(), "Wikipedia");
});

Deno.test("a body with no length is read to the end", async () => {
  const fake = fakeSockets(PUBLIC, "HTTP/1.1 404 Not Found\r\n\r\nmissing");
  const response = await socketFetch(fake.sockets)("https://rock.example.org/");
  assertEquals(response.status, 404);
  assertEquals(await response.text(), "missing");
});

Deno.test("a no-content answer has no body", async () => {
  const fake = fakeSockets(PUBLIC, "HTTP/1.1 204 No Content\r\n\r\n");
  const response = await socketFetch(fake.sockets)("https://rock.example.org/");
  assertEquals(response.status, 204);
  assertEquals(response.body, null);
});

Deno.test("redirects, oversized, short and malformed answers are refused", async () => {
  for (const [answer, message] of [
    ["HTTP/1.1 302 Found\r\nlocation: https://10.0.0.5/\r\ncontent-length: 0\r\n\r\n", "Redirects are refused."],
    [`HTTP/1.1 200 OK\r\ncontent-length: ${6 * 1024 * 1024}\r\n\r\n`, "The response is too large."],
    ["HTTP/1.1 200 OK\r\ntransfer-encoding: chunked\r\n\r\n600000\r\n", "The response is too large."],
    ["HTTP/1.1 200 OK\r\ncontent-length: 10\r\n\r\nshort", "The response ended early."],
    ["HTTP/1.1 200 OK\r\ncontent-length: 1, 2\r\n\r\nx", "The response is malformed."],
    ["HTTP/1.1 200 OK\r\ntransfer-encoding: chunked\r\n\r\nzz\r\n", "The response is malformed."],
    ["HTTP/1.1 200 OK\r\ntransfer-encoding: chunked\r\n\r\n1\r\nx\r\n0\r\n", "The response ended early."],
    ["HTTP/1.1 200 OK\r\ntransfer-encoding: chunked\r\n\r\n1\r\nx\r\n0\r\na: b\r\n", "The response ended early."],
    ["SSH-2.0-OpenSSH\r\n\r\n", "The response is malformed."],
    ["HTTP/1.1 200 OK\r\ncontent-length: 3\r\n", "The response ended early."],
  ] as const) {
    const fake = fakeSockets(PUBLIC, answer);
    await assertRejects(() => socketFetch(fake.sockets)("https://rock.example.org/"), TypeError, message);
    assert(fake.closed(), answer);
  }
});

Deno.test("a body read to the end is refused past the size limit", async () => {
  const fake = fakeSockets(PUBLIC, new Uint8Array([
    ...new TextEncoder().encode("HTTP/1.1 200 OK\r\n\r\n"),
    ...new Uint8Array(5 * 1024 * 1024 + 1),
  ]), 64 * 1024);
  await assertRejects(() => socketFetch(fake.sockets)("https://rock.example.org/"), TypeError, "The response is too large.");
});

Deno.test("a head past the limit is refused even when its end arrives in the same read", async () => {
  const head = `HTTP/1.1 200 OK\r\nx-pad: ${"a".repeat(64 * 1024)}\r\n\r\n`;
  const fake = fakeSockets(PUBLIC, head, 128 * 1024);
  await assertRejects(() => socketFetch(fake.sockets)("https://rock.example.org/"), TypeError, "The response is malformed.");
});

Deno.test("header bytes above 0x7f keep their values", async () => {
  const fake = fakeSockets(PUBLIC, new Uint8Array([
    ...new TextEncoder().encode("HTTP/1.1 200 OK\r\nx-name: a"),
    0x80,
    0xe9,
    ...new TextEncoder().encode("\r\ncontent-length: 0\r\n\r\n"),
  ]));
  const response = await socketFetch(fake.sockets)("https://rock.example.org/");
  assertEquals(response.headers.get("x-name"), "a\u0080\u00e9");
});

Deno.test("a body of many one-byte chunks is decoded whole", async () => {
  const count = 100_000;
  const fake = fakeSockets(
    PUBLIC,
    "HTTP/1.1 200 OK\r\ntransfer-encoding: chunked\r\n\r\n" + "1\r\nx\r\n".repeat(count) + "0\r\n\r\n",
    64 * 1024,
  );
  const response = await socketFetch(fake.sockets)("https://rock.example.org/");
  assertEquals((await response.text()).length, count);
});

Deno.test("a chunk-size line at the limit is read when its CRLF is split across reads", async () => {
  const head = "HTTP/1.1 200 OK\r\ntransfer-encoding: chunked\r\n\r\n";
  const line = "0".repeat(1023) + "2";
  const fake = fakeSockets(PUBLIC, head + line + "\r\nok\r\n0\r\n\r\n", head.length + line.length + 1);
  const response = await socketFetch(fake.sockets)("https://rock.example.org/");
  assertEquals(await response.text(), "ok");
});

Deno.test("a chunk-size line past the limit is refused", async () => {
  const head = "HTTP/1.1 200 OK\r\ntransfer-encoding: chunked\r\n\r\n";
  const fake = fakeSockets(PUBLIC, head + "0".repeat(1024) + "2\r\nok\r\n0\r\n\r\n");
  await assertRejects(
    () => socketFetch(fake.sockets)("https://rock.example.org/"),
    TypeError,
    "The response is malformed.",
  );
});

Deno.test("an already aborted request never resolves the name", async () => {
  const fake = fakeSockets(PUBLIC, OK);
  const controller = new AbortController();
  controller.abort();
  await assertRejects(
    () => socketFetch(fake.sockets)("https://rock.example.org/", { signal: controller.signal }),
    TypeError,
    "The request was aborted.",
  );
  assertEquals(fake.resolved, []);
});

Deno.test("an abort while waiting for the answer closes the connection", async () => {
  const fake = fakeSockets(PUBLIC, OK);
  const controller = new AbortController();
  let closed = false;
  const hanging: SocketConn = {
    read: () => new Promise(() => {}),
    write: (p) => Promise.resolve(p.length),
    close() {
      closed = true;
    },
  };
  const sockets: Sockets = { ...fake.sockets, startTls: () => Promise.resolve(hanging) };
  const pending = socketFetch(sockets)("https://rock.example.org/", { signal: controller.signal });
  setTimeout(() => controller.abort(), 0);
  await assertRejects(() => pending, TypeError, "The request was aborted.");
  assertEquals(closed, true);
});

Deno.test("the next checked address is tried when one won't connect", async () => {
  const fake = fakeSockets([...PUBLIC, { address: "2606:4700::1111", family: 6 }], OK);
  const sockets: Sockets = {
    ...fake.sockets,
    connect: (address, port) =>
      address === "93.184.215.14" ? Promise.reject(new Error("unreachable")) : fake.sockets.connect(address, port),
  };
  const response = await socketFetch(sockets)("https://rock.example.org/");
  assertEquals(response.status, 200);
  assertEquals(fake.connected, [["2606:4700::1111", 443]]);
});

Deno.test("an address that never connects gives way to the next, and closes if it opens late", async () => {
  const fake = fakeSockets([...PUBLIC, { address: "2606:4700::1111", family: 6 }], OK);
  let openLate!: (conn: SocketConn) => void;
  let lateClosed = false;
  const sockets: Sockets = {
    ...fake.sockets,
    connect: (address, port) =>
      address === "93.184.215.14"
        ? new Promise((resolve) => (openLate = resolve))
        : fake.sockets.connect(address, port),
  };
  const response = await socketFetch(sockets, 10)("https://rock.example.org/");
  assertEquals(response.status, 200);
  assertEquals(fake.connected, [["2606:4700::1111", 443]]);
  openLate({
    read: () => Promise.resolve(null),
    write: (p) => Promise.resolve(p.length),
    close() {
      lateClosed = true;
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assertEquals(lateClosed, true);
});

Deno.test("only GET and POST without a body go over https", async () => {
  const fake = fakeSockets(PUBLIC, OK);
  const fetcher = socketFetch(fake.sockets);
  await assertRejects(() => fetcher("https://rock.example.org/", { method: "DELETE" }), TypeError);
  await assertRejects(() => fetcher("https://rock.example.org/", { method: "POST", body: "x" }), TypeError);
  await assertRejects(() => fetcher("http://rock.example.org/"), TypeError);
  assertEquals(fake.resolved, []);
});

Deno.test("the address check passes when loopback is refused", async () => {
  const fake = fakeSockets([{ address: "127.0.0.1", family: 4 }, { address: "::1", family: 6 }], OK);
  await assertAddressGuard(socketFetch(fake.sockets));
  assertEquals(fake.connected, []);
});

Deno.test("the address check fails when a loopback request isn't refused", async () => {
  await assertRejects(() => assertAddressGuard(socketFetch(fakeSockets(PUBLIC, OK).sockets)));
  await assertRejects(() => assertAddressGuard(() => Promise.reject(new Error("Not implemented: lookup"))));
});
