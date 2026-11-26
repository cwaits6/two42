import { assertEquals } from "jsr:@std/assert@1";
import { normalizePostalCode, normalizeState } from "../_shared/address-case.ts";

Deno.test("normalizeState reads codes and full names, and nothing inherited", () => {
  assertEquals(normalizeState("tx"), "TX");
  assertEquals(normalizeState(" Texas "), "TX");
  assertEquals(normalizeState("__proto__"), null);
  assertEquals(normalizeState("constructor"), null);
});

Deno.test("normalizePostalCode accepts only a ZIP or ZIP+4", () => {
  assertEquals(normalizePostalCode("12345"), "12345");
  assertEquals(normalizePostalCode(" 12345-6789 "), "12345-6789");
  assertEquals(normalizePostalCode("123456789"), "12345-6789");
  assertEquals(normalizePostalCode("A12B345"), null);
  assertEquals(normalizePostalCode("12345-67"), null);
});
