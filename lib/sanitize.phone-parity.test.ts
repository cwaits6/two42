import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PHONE_FIXTURES } from "@/supabase/functions/_shared/phone-fixtures";
import { normalizePhone } from "./sanitize";

describe("normalizePhone", () => {
  it.each(PHONE_FIXTURES)("stores %j as %j, as the edge functions' copy does", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });
});

describe("the edge functions' libphonenumber-js", () => {
  it("is the release package-lock.json installs for the app", () => {
    const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
    const edge = readFileSync("supabase/functions/_shared/phone.ts", "utf8").match(/npm:libphonenumber-js@([\d.]+)/)?.[1];
    expect(edge).toBe(lock.packages["node_modules/libphonenumber-js"].version);
  });
});
