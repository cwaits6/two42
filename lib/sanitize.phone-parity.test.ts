import { describe, expect, it } from "vitest";
import { PHONE_FIXTURES } from "@/supabase/functions/_shared/phone-fixtures";
import { normalizePhone } from "./sanitize";

describe("normalizePhone", () => {
  it.each(PHONE_FIXTURES)("stores %j as %j, as the edge functions' copy does", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });
});
