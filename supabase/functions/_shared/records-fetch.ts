// The only way a church's key leaves two42: a GET over https that checks every
// address the host name resolves to at the moment it connects, so a public
// name pointed at a private address (by DNS, or by rebinding between a check
// and the request) is refused before the key is sent. Redirects are refused
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

/** A `lookup` for node:https that fails unless every address the name resolves to is public. */
export function guardedLookup(resolve: Resolve = dnsLookup as unknown as Resolve) {
  return (hostname: string, options: { all?: boolean; family?: number | string }, callback: LookupCallback) => {
    const family = options.family === "IPv4" ? 4 : options.family === "IPv6" ? 6 : Number(options.family ?? 0);
    resolve(hostname, { all: true, family }, (err, addresses) => {
      if (err) return callback(err, "");
      if (addresses.length === 0 || addresses.some((a) => !isPublicAddress(a.address))) {
        return callback(new RefusedAddressError(), "");
      }
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

/**
 * A fetch-shaped GET for a church's records. Rejects, as fetch would on a
 * network failure, when the address isn't public, the response redirects,
 * runs past the timeout or is larger than any answer two42 asks for.
 */
export function safeFetch(input: URL | string, init: RequestInit = {}): Promise<Response> {
  const url = new URL(String(input));
  if (url.protocol !== "https:") return Promise.reject(new TypeError("Only https is allowed."));
  const literal = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(literal) && !isPublicAddress(literal)) return Promise.reject(new RefusedAddressError());
  const headers = Object.fromEntries(new Headers(init.headers).entries());
  // Bodies are returned as received, never decoded, so none may be compressed.
  headers["accept-encoding"] ??= "identity";

  return new Promise((resolve, reject) => {
    const req = request(url, { method: "GET", headers, lookup: guardedLookup() }, (res) => {
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
    const signal = init.signal;
    if (signal) {
      if (signal.aborted) req.destroy(new TypeError("The request was aborted."));
      else signal.addEventListener("abort", () => req.destroy(new TypeError("The request was aborted.")), { once: true });
    }
    req.end();
  });
}

/**
 * Proves the address check runs where this code is deployed: a request to a
 * loopback name must be refused before it connects. A runtime that ignored
 * the lookup hook would send a church's key wherever DNS pointed, so a caller
 * stops before any key is opened when this rejects.
 */
export async function assertAddressGuard(): Promise<void> {
  try {
    const response = await safeFetch("https://localhost/");
    await response.body?.cancel();
  } catch (err) {
    if (err instanceof RefusedAddressError) return;
  }
  throw new Error("The records address check did not refuse a loopback address.");
}
