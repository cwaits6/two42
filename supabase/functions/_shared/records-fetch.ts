// The only way a church's key leaves two42: a GET, or a POST with no body that
// sends a new person, over https to a host name every address of which was
// checked, so a public name pointed at a private address (by DNS, or by
// rebinding between a check and the request) is refused before the key is sent.
// On Deno the name is resolved once and the socket opened to a checked address,
// with the name used for TLS; the Edge Runtime has no `lookup` on node:https.
// On Node the check runs in the connection's `lookup`. Redirects are refused
// too, since one could carry the request somewhere the address check never saw.
import { Buffer } from "node:buffer";
import { lookup as dnsLookup, type LookupAddress, type LookupAllOptions } from "node:dns";
import { request } from "node:https";
import { BlockList, isIP } from "node:net";

// Every IPv4 range that isn't ordinary public unicast: private, loopback,
// link-local, shared, benchmarking, documentation, multicast and reserved.
// IPv4-mapped IPv6 addresses are checked against these too.
const SPECIAL = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  SPECIAL.addSubnet(network, prefix, "ipv4");
}

// IPv6 is public only inside global unicast, minus the ranges carved out of it
// for documentation, translation and tunnelling.
const GLOBAL_V6 = new BlockList();
GLOBAL_V6.addSubnet("2000::", 3, "ipv6");
const SPECIAL_V6 = new BlockList();
for (const [network, prefix] of [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
] as const) {
  SPECIAL_V6.addSubnet(network, prefix, "ipv6");
}

/** Whether an IP address is ordinary public unicast, the only kind two42 sends a church's key to. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !SPECIAL.check(address, "ipv4");
  if (family !== 6) return false;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return !SPECIAL.check(mapped[1], "ipv4");
  return GLOBAL_V6.check(address, "ipv6") && !SPECIAL_V6.check(address, "ipv6");
}

const TIMEOUT_MS = 10_000;
const MAX_BYTES = 5 * 1024 * 1024;

type Resolve = (hostname: string, options: LookupAllOptions, callback: (err: Error | null, addresses: LookupAddress[]) => void) => void;
type LookupCallback = (err: Error | null, address: string | LookupAddress[], family?: number) => void;

export class RefusedAddressError extends Error {
  constructor() {
    super("The host resolves to an address two42 doesn't send requests to.");
  }
}

/** The one rule both transports connect by: at least one address, and every one public. */
function allPublic(addresses: readonly LookupAddress[]): boolean {
  return addresses.length > 0 && addresses.every((a) => isPublicAddress(a.address));
}

/** A `lookup` for node:https that fails unless every address the name resolves to is public. */
export function guardedLookup(resolve: Resolve = dnsLookup as unknown as Resolve) {
  return (hostname: string, options: { all?: boolean; family?: number | string }, callback: LookupCallback) => {
    const family = options.family === "IPv4" ? 4 : options.family === "IPv6" ? 6 : Number(options.family ?? 0);
    resolve(hostname, { all: true, family }, (err, addresses) => {
      if (err) return callback(err, "");
      if (!allPublic(addresses)) return callback(new RefusedAddressError(), "");
      if (options.all) return callback(null, addresses);
      callback(null, addresses[0].address, addresses[0].family);
    });
  };
}

function responseHeaders(raw: Record<string, string | string[] | undefined>): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) headers.append(name, item);
  }
  return headers;
}

interface Prepared {
  url: URL;
  /** The URL's host without IPv6 brackets: the name resolved, or the literal checked. */
  hostname: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  signal: AbortSignal | null | undefined;
}

function prepare(input: URL | string, init: RequestInit): Prepared {
  const method = init.method?.toUpperCase() ?? "GET";
  if (method !== "GET" && method !== "POST") throw new TypeError("Only GET and POST are allowed.");
  if (init.body != null) throw new TypeError("Request bodies aren't sent.");
  const url = new URL(String(input));
  if (url.protocol !== "https:") throw new TypeError("Only https is allowed.");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const literalFamily = isIP(hostname);
  if (literalFamily && !allPublic([{ address: hostname, family: literalFamily }])) throw new RefusedAddressError();
  const headers = Object.fromEntries(new Headers(init.headers).entries());
  if (method === "POST") headers["content-length"] = "0";
  // Bodies are returned as received, never decoded, so none may be compressed.
  headers["accept-encoding"] ??= "identity";
  return { url, hostname, method, headers, signal: init.signal };
}

type Bytes = Uint8Array<ArrayBuffer>;
type FetchLike = (input: URL | string, init?: RequestInit) => Promise<Response>;

/**
 * A fetch-shaped GET, or POST with no body, for a church's records. Rejects, as fetch would on a
 * network failure, when the address isn't public, the response redirects,
 * runs past the timeout or is larger than any answer two42 asks for.
 */
export const safeFetch: FetchLike = (input, init = {}) => {
  const sockets = denoSockets();
  if (sockets) return socketFetch(sockets)(input, init);
  let prepared: Prepared;
  try {
    prepared = prepare(input, init);
  } catch (err) {
    return Promise.reject(err);
  }
  return nodeFetch(prepared);
};

function nodeFetch({ url, method, headers, signal }: Prepared): Promise<Response> {
  // A caller's signal can outlive this request, so its listener goes once the request settles.
  let onAbort: (() => void) | undefined;
  return new Promise<Response>((resolve, reject) => {
    const req = request(url, { method, headers, lookup: guardedLookup() }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400) {
        res.resume();
        req.destroy();
        reject(new TypeError("Redirects are refused."));
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BYTES) {
          req.destroy(new TypeError("The response is too large."));
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => {
        clearTimeout(timer);
        const empty = status === 204 || status === 205 || status === 304;
        try {
          resolve(new Response(empty ? null : Buffer.concat(chunks), { status, headers: responseHeaders(res.headers) }));
        } catch (err) {
          // A status Response refuses, such as 600.
          reject(err);
        }
      });
      res.on("error", reject);
    });
    const timer = setTimeout(() => req.destroy(new TypeError("The request timed out.")), TIMEOUT_MS);
    req.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    if (signal) {
      if (signal.aborted) req.destroy(new TypeError("The request was aborted."));
      else {
        onAbort = () => req.destroy(new TypeError("The request was aborted."));
        signal.addEventListener("abort", onAbort, { once: true });
      }
    }
    req.end();
  }).finally(() => {
    if (onAbort) signal?.removeEventListener("abort", onAbort);
  });
}

export interface SocketConn {
  read(p: Uint8Array): Promise<number | null>;
  write(p: Uint8Array): Promise<number>;
  close(): void;
}

/** What the socket transport needs from the runtime; tests pass fakes. */
export interface Sockets {
  resolve(hostname: string): Promise<LookupAddress[]>;
  connect(address: string, port: number): Promise<SocketConn>;
  startTls(conn: SocketConn, hostname: string): Promise<SocketConn>;
}

interface DenoSocketApi {
  connect(options: { hostname: string; port: number }): Promise<SocketConn>;
  startTls(conn: SocketConn, options: { hostname: string }): Promise<SocketConn>;
}

function denoSockets(): Sockets | null {
  const deno = (globalThis as unknown as { Deno?: Partial<DenoSocketApi> }).Deno;
  const connect = deno?.connect?.bind(deno);
  const startTls = deno?.startTls?.bind(deno);
  if (!connect || !startTls) return null;
  return {
    resolve: (hostname) =>
      new Promise((resolve, reject) =>
        dnsLookup(hostname, { all: true }, (err, addresses) => (err ? reject(err) : resolve(addresses)))
      ),
    connect: (address, port) => connect({ hostname: address, port }),
    startTls: (conn, hostname) => startTls(conn, { hostname }),
  };
}

/** Every address `hostname` resolves to, IPv4 first, or a refusal unless all of them are public. */
async function checkedAddresses(hostname: string, resolve: Sockets["resolve"]): Promise<string[]> {
  const literalFamily = isIP(hostname);
  const addresses = literalFamily ? [{ address: hostname, family: literalFamily }] : await resolve(hostname);
  if (!allPublic(addresses)) throw new RefusedAddressError();
  return [...addresses].sort((a, b) => a.family - b.family).map((a) => a.address);
}

function closeQuietly(conn: SocketConn | undefined) {
  try {
    conn?.close();
  } catch {
    // Already closed.
  }
}

/**
 * The fetch-shaped records request over a socket opened to an address checked
 * moments before, so nothing resolves the name between the check and the connect.
 * Speaks HTTP/1.1 with `connection: close`: the callers ask for one small answer.
 */
export function socketFetch(sockets: Sockets): FetchLike {
  return async (input, init = {}) => {
    const { url, hostname, method, headers, signal } = prepare(input, init);
    if (signal?.aborted) throw new TypeError("The request was aborted.");

    let conn: SocketConn | undefined;
    let halted: TypeError | undefined;
    let rejectHalt!: (err: TypeError) => void;
    const halt = new Promise<never>((_, reject) => (rejectHalt = reject));
    const stop = (err: TypeError) => {
      halted ??= err;
      rejectHalt(halted);
      closeQuietly(conn);
    };
    const timer = setTimeout(() => stop(new TypeError("The request timed out.")), TIMEOUT_MS);
    const onAbort = () => stop(new TypeError("The request was aborted."));
    signal?.addEventListener("abort", onAbort, { once: true });
    // A connection that opens after the request stopped is closed at once.
    const keep = (opened: SocketConn) => {
      conn = opened;
      if (halted) {
        closeQuietly(opened);
        throw halted;
      }
      return opened;
    };

    const run = async () => {
      const addresses = await checkedAddresses(hostname, sockets.resolve);
      if (halted) throw halted;
      const port = Number(url.port || 443);
      let tcp: SocketConn | undefined;
      let lastError: unknown;
      for (const address of addresses) {
        try {
          tcp = keep(await sockets.connect(address, port));
          break;
        } catch (err) {
          if (halted) throw halted;
          lastError = err;
        }
      }
      if (!tcp) throw lastError;
      const tls = keep(await sockets.startTls(tcp, hostname));
      await writeAll(tls, requestHead(url, method, headers));
      return await readResponse(new ByteReader(tls));
    };

    try {
      return await Promise.race([run(), halt]);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      closeQuietly(conn);
    }
  };
}

function requestHead(url: URL, method: string, headers: Record<string, string>): Uint8Array {
  const lines = [`${method} ${url.pathname}${url.search} HTTP/1.1`, `host: ${url.host}`];
  for (const [name, value] of Object.entries(headers)) {
    if (name === "host" || name === "connection" || name === "transfer-encoding") continue;
    lines.push(`${name}: ${value}`);
  }
  lines.push("connection: close", "", "");
  return new TextEncoder().encode(lines.join("\r\n"));
}

async function writeAll(conn: SocketConn, bytes: Uint8Array) {
  let written = 0;
  while (written < bytes.length) written += await conn.write(bytes.subarray(written));
}

const CRLF = new Uint8Array([13, 10]);
const HEAD_END = new Uint8Array([13, 10, 13, 10]);
const MAX_HEAD_BYTES = 64 * 1024;

function indexOf(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

function concat(parts: Bytes[], size: number): Bytes {
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

class ByteReader {
  #pending: Bytes = new Uint8Array(0);
  readonly #conn: SocketConn;
  constructor(conn: SocketConn) {
    this.#conn = conn;
  }

  async #more(): Promise<boolean> {
    const chunk = new Uint8Array(16 * 1024);
    const n = await this.#conn.read(chunk);
    if (n === null) return false;
    const read = chunk.subarray(0, n);
    this.#pending = this.#pending.length ? concat([this.#pending, read], this.#pending.length + n) : read;
    return true;
  }

  /** The bytes before `delimiter`, consuming both; null at the end of the stream. */
  async until(delimiter: Bytes, max: number): Promise<Bytes | null> {
    let from = 0;
    while (true) {
      const at = indexOf(this.#pending.subarray(from), delimiter);
      if (at >= 0) {
        const before = this.#pending.subarray(0, from + at);
        this.#pending = this.#pending.subarray(from + at + delimiter.length);
        return before;
      }
      if (this.#pending.length > max) throw new TypeError("The response is malformed.");
      from = Math.max(0, this.#pending.length - delimiter.length + 1);
      if (!(await this.#more())) return null;
    }
  }

  /** Up to `max` bytes, at least one unless the stream has ended. */
  async take(max: number): Promise<Bytes> {
    if (this.#pending.length === 0 && !(await this.#more())) return new Uint8Array(0);
    const out = this.#pending.subarray(0, max);
    this.#pending = this.#pending.subarray(out.length);
    return out;
  }
}

class Body {
  readonly parts: Bytes[] = [];
  size = 0;
  add(part: Bytes) {
    this.size += part.length;
    if (this.size > MAX_BYTES) throw new TypeError("The response is too large.");
    this.parts.push(part);
  }
}

const ENDED_EARLY = "The response ended early.";

async function readExactly(reader: ByteReader, length: number, body: Body) {
  let left = length;
  while (left > 0) {
    const part = await reader.take(left);
    if (part.length === 0) throw new TypeError(ENDED_EARLY);
    body.add(part);
    left -= part.length;
  }
}

async function readChunked(reader: ByteReader, body: Body) {
  while (true) {
    const line = await reader.until(CRLF, 1024);
    if (line === null) throw new TypeError(ENDED_EARLY);
    const size = new TextDecoder().decode(line).split(";")[0].trim();
    if (!/^[0-9a-f]+$/i.test(size)) throw new TypeError("The response is malformed.");
    const length = parseInt(size, 16);
    if (length === 0) break;
    if (body.size + length > MAX_BYTES) throw new TypeError("The response is too large.");
    await readExactly(reader, length, body);
    const end = await reader.until(CRLF, CRLF.length);
    if (end === null || end.length !== 0) throw new TypeError("The response is malformed.");
  }
  // Trailer fields, which nothing reads, up to the blank line.
  while (true) {
    const line = await reader.until(CRLF, MAX_HEAD_BYTES);
    if (line === null || line.length === 0) return;
  }
}

async function readToEnd(reader: ByteReader, body: Body) {
  while (true) {
    const part = await reader.take(MAX_BYTES);
    if (part.length === 0) return;
    body.add(part);
  }
}

async function readHead(reader: ByteReader): Promise<{ status: number; headers: Headers }> {
  // Interim 1xx answers come before the real one and carry no body.
  while (true) {
    const raw = await reader.until(HEAD_END, MAX_HEAD_BYTES);
    if (raw === null) throw new TypeError(ENDED_EARLY);
    const [statusLine, ...fields] = new TextDecoder("latin1").decode(raw).split("\r\n");
    const match = /^HTTP\/1\.[01] (\d{3})(?: .*)?$/.exec(statusLine);
    if (!match) throw new TypeError("The response is malformed.");
    const status = Number(match[1]);
    const headers = new Headers();
    for (const field of fields) {
      const colon = field.indexOf(":");
      if (colon <= 0 || /^\s/.test(field)) throw new TypeError("The response is malformed.");
      headers.append(field.slice(0, colon).trim(), field.slice(colon + 1).trim());
    }
    if (status >= 200) return { status, headers };
  }
}

async function readResponse(reader: ByteReader): Promise<Response> {
  const { status, headers } = await readHead(reader);
  if (status >= 300 && status < 400) throw new TypeError("Redirects are refused.");
  const empty = status === 204 || status === 205 || status === 304;
  if (empty) return new Response(null, { status, headers });
  const body = new Body();
  const encoding = headers.get("transfer-encoding");
  const length = headers.get("content-length");
  if (encoding) {
    if (encoding.split(",").at(-1)!.trim().toLowerCase() === "chunked") await readChunked(reader, body);
    else await readToEnd(reader, body);
  } else if (length !== null) {
    const values = new Set(length.split(",").map((v) => v.trim()));
    const [value] = values;
    if (values.size !== 1 || !/^\d+$/.test(value)) throw new TypeError("The response is malformed.");
    if (Number(value) > MAX_BYTES) throw new TypeError("The response is too large.");
    await readExactly(reader, Number(value), body);
  } else {
    await readToEnd(reader, body);
  }
  return new Response(concat(body.parts, body.size), { status, headers });
}

/**
 * Proves the address check runs where this code is deployed: a request to a
 * loopback name must be refused before it connects. A runtime whose transport
 * skipped the check would send a church's key wherever DNS pointed, so a caller
 * stops before any key is opened when this rejects.
 */
export async function assertAddressGuard(fetcher: FetchLike = safeFetch): Promise<void> {
  try {
    const response = await fetcher("https://localhost/");
    await response.body?.cancel();
  } catch (err) {
    if (err instanceof RefusedAddressError) return;
  }
  throw new Error("The records address check did not refuse a loopback address.");
}
