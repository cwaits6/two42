// A church admin types the address of their church records and the server
// then sends requests carrying the church's key to it, so the address is the boundary that
// keeps those requests off two42's own network. DNS can still point a public
// name at a private address; the client refuses redirects, so a rebinding host
// gets the one request and nothing back but its own error.
import { isIP } from "node:net";

export type RecordsAddress = { ok: true; origin: string } | { ok: false; reason: string };

const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home.arpa"];

function privateIPv4(host: string): boolean {
  const parts = host.split(".").map(Number);
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
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
  if (family === 4 && privateIPv4(bare)) return { ok: false, reason: `Use your ${product}'s public address.` };
  // Any IPv6 literal is refused rather than classifying every reserved range.
  if (family === 6) return { ok: false, reason: `Use your ${product}'s host name, not an IPv6 address.` };
  if (family === 0 && !host.includes(".")) return { ok: false, reason: `Use your ${product}'s full public address.` };
  return { ok: true, origin: url.origin };
}
