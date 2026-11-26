import { assertEquals } from "jsr:@std/assert@1";
import { normalizePhone } from "../_shared/phone.ts";
import { PHONE_FIXTURES } from "../_shared/phone-fixtures.ts";

Deno.test("normalizePhone stores what the app's normalizer stores", () => {
  for (const [input, expected] of PHONE_FIXTURES) assertEquals(normalizePhone(input), expected, input);
});
