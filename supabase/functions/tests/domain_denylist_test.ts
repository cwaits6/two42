// Unit tests for the worker's apex denylist. Mirrors the label-boundary
// contract of classifyHost() in lib/org.ts (tested in lib/org.test.ts); a
// change to that rule lands on both sides.

import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  DEFAULT_PLATFORM_APEX,
  isPlatformApexOrSubdomain,
  resolvePlatformApex,
} from "../_shared/domain-denylist.ts";

const APEX = "two42.io";

Deno.test("the apex itself is denylisted", () => {
  assertEquals(isPlatformApexOrSubdomain("two42.io", APEX), true);
});

Deno.test("a direct subdomain of the apex is denylisted", () => {
  assertEquals(isPlatformApexOrSubdomain("grace.two42.io", APEX), true);
});

Deno.test("a multi-label subdomain of the apex is denylisted", () => {
  assertEquals(isPlatformApexOrSubdomain("www.grace.two42.io", APEX), true);
});

Deno.test("matching is case-insensitive on both sides", () => {
  assertEquals(isPlatformApexOrSubdomain("Grace.TWO42.io", APEX), true);
  assertEquals(isPlatformApexOrSubdomain("grace.two42.io", "Two42.IO"), true);
});

Deno.test("a trailing FQDN dot on either side is ignored", () => {
  assertEquals(isPlatformApexOrSubdomain("grace.two42.io.", APEX), true);
  assertEquals(isPlatformApexOrSubdomain("grace.two42.io", "two42.io."), true);
});

Deno.test("a registrable name that merely ends with the apex string is NOT denylisted", () => {
  // Exact label boundary: "evil-two42.io" is a different registrable domain.
  assertEquals(isPlatformApexOrSubdomain("evil-two42.io", APEX), false);
});

Deno.test("a name that contains the apex as a non-suffix substring is NOT denylisted", () => {
  assertEquals(isPlatformApexOrSubdomain("not-two42.io.evil.example", APEX), false);
  assertEquals(isPlatformApexOrSubdomain("two42.io.example.church", APEX), false);
});

Deno.test("an ordinary custom domain is allowed", () => {
  assertEquals(isPlatformApexOrSubdomain("example.church", APEX), false);
  assertEquals(isPlatformApexOrSubdomain("www.example.church", APEX), false);
});

Deno.test("an empty host or empty apex is never denylisted (nothing to shadow)", () => {
  assertEquals(isPlatformApexOrSubdomain("", APEX), false);
  assertEquals(isPlatformApexOrSubdomain("example.church", ""), false);
});

// ── resolvePlatformApex (the startup read of the PLATFORM_APEX secret) ──────

Deno.test("resolvePlatformApex: unset or empty means the default", () => {
  assertEquals(resolvePlatformApex(undefined), DEFAULT_PLATFORM_APEX);
  assertEquals(resolvePlatformApex(""), DEFAULT_PLATFORM_APEX);
  assertEquals(resolvePlatformApex(undefined, "example.org"), "example.org");
});

Deno.test("resolvePlatformApex: a set value is canonicalised", () => {
  assertEquals(resolvePlatformApex(" Example.ORG. "), "example.org");
});

Deno.test("resolvePlatformApex: a whitespace-only value throws instead of disabling the denylist", () => {
  assertThrows(() => resolvePlatformApex("   "), Error, "PLATFORM_APEX is set but blank");
  assertThrows(() => resolvePlatformApex("\t\n"), Error);
});
