// A church admin types the address of their church records and the server
// then sends requests carrying the church's key to it, so the address is the
// boundary that keeps those requests off two42's own network. The text is
// checked here; safeFetch() checks every address the name resolves to when it
// connects, since DNS can point a public name at a private address.
import { BlockList, isIP } from "node:net";

export type RecordsAddress = { ok: true; origin: string } | { ok: false; reason: string };

const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home.arpa"];

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

/**
 * The origin requests go to, or why the address can't be used. Only an https
 * origin on a public host name or public address is accepted; any path is
 * dropped, because the providers two42 reads serve their API from the root.
 * `product` names the software in the reasons.
 */
export function parseRecordsAddress(input: string, product: string): RecordsAddress {
  const text = input.trim();
  if (!text) return { ok: false, reason: `Enter your ${product} address.` };
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return { ok: false, reason: "Enter a web address, like https://records.yourchurch.org." };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "The address must start with https://." };
  if (url.username || url.password) return { ok: false, reason: "Leave the user name and password out of the address." };
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const bare = host.replace(/^\[|\]$/g, "");
  if (host === "localhost" || BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return { ok: false, reason: `Use your ${product}'s public address.` };
  }
  const family = isIP(bare);
  if (family === 4 && !isPublicAddress(bare)) return { ok: false, reason: `Use your ${product}'s public address.` };
  // Any IPv6 literal is refused: a church's records are reached by name.
  if (family === 6) return { ok: false, reason: `Use your ${product}'s host name, not an IPv6 address.` };
  if (family === 0 && !host.includes(".")) return { ok: false, reason: `Use your ${product}'s full public address.` };
  return { ok: true, origin: url.origin };
}
