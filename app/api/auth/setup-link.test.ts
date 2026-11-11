import { describe, expect, it } from "vitest";
import { isUuid } from "@/lib/groups/active";
import { classifySetupRow, readSetupToken, setupUserId } from "./setup-link";

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

describe("classifySetupRow", () => {
  const now = new Date("2026-06-01T00:00:00Z");
  const row = (token_expires_at: string | null, org_id: string | null = "org-1") => ({ org_id, token_expires_at });

  it("calls a missing row or one without an org unknown", () => {
    expect(classifySetupRow(null, now).state).toBe("unknown");
    expect(classifySetupRow(row(null, null), now).state).toBe("unknown");
  });

  it("calls a row past its expiry expired", () => {
    expect(classifySetupRow(row("2026-05-31T23:59:59Z"), now).state).toBe("expired");
  });

  it("calls a row with no expiry or a future one live", () => {
    expect(classifySetupRow(row(null), now)).toEqual({ state: "live", row: row(null) });
    expect(classifySetupRow(row("2026-06-01T00:00:01Z"), now).state).toBe("live");
  });
});
