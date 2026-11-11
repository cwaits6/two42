import { describe, expect, it } from "vitest";
import { isUuid } from "@/lib/groups/active";
import { readSetupToken, setupUserId } from "./setup-link";

describe("setupUserId", () => {
  it("gives the same link the same account id", () => {
    expect(setupUserId("abc")).toBe(setupUserId("abc"));
  });

  it("gives different links different account ids", () => {
    expect(setupUserId("abc")).not.toBe(setupUserId("abd"));
  });

  it("is a version 8 uuid the app accepts as an id", () => {
    const id = setupUserId("f".repeat(64));
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(isUuid(id)).toBe(true);
  });
});

describe("readSetupToken", () => {
  it.each([null, "abc", {}, { token: "" }, { token: 7 }, { token: "a".repeat(513) }])(
    "refuses %j",
    (body) => {
      expect(readSetupToken(body)).toBeNull();
    },
  );

  it("accepts a non-empty string token", () => {
    expect(readSetupToken({ token: "signup-notice-token" })).toBe("signup-notice-token");
  });
});
