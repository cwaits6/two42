import { describe, expect, it } from "vitest";
import type { AccessRequest } from "@/lib/types";
import { invitedNotSignedUp } from "./invited";

type Row = Pick<AccessRequest, "status" | "email" | "signup_token" | "token_expires_at">;

const request = (over: Partial<Row> = {}): Row => ({
  status: "approved",
  email: "ana@example.test",
  signup_token: "token",
  token_expires_at: "2026-11-10T00:00:00Z",
  ...over,
});

describe("invitedNotSignedUp", () => {
  it("keeps an invitee who shares a name with a member", () => {
    const invite = request();
    const namesake = { email: "other.ana@example.test", first_name: "Ana", last_name: "Seedly" };
    expect(invitedNotSignedUp([invite], [namesake])).toEqual([invite]);
  });

  it("drops someone who joined under a different name", () => {
    const joined = { email: "ana@example.test", first_name: "Anna", last_name: "Wed" };
    expect(invitedNotSignedUp([request()], [joined])).toEqual([]);
  });

  it("ignores case and surrounding spaces when comparing emails", () => {
    expect(invitedNotSignedUp([request({ email: " Ana@Example.TEST " })], [{ email: "ana@example.test" }])).toEqual([]);
  });

  it("does not match a member with no email", () => {
    const invite = request();
    expect(invitedNotSignedUp([invite], [{ email: null }])).toEqual([invite]);
  });

  it("does not match a request with no email to a member with none", () => {
    const invite = request({ email: "" });
    expect(invitedNotSignedUp([invite], [{ email: null }, { email: "" }])).toEqual([invite]);
  });

  it("drops someone whose sign-up used the token, even after changing their email", () => {
    expect(
      invitedNotSignedUp([request({ signup_token: null })], [{ email: "new.ana@example.test" }]),
    ).toEqual([]);
  });

  it("keeps an invitee whose setup email failed to send", () => {
    const unsent = request({ signup_token: null, token_expires_at: null });
    expect(invitedNotSignedUp([unsent], [{ email: "other@example.test" }])).toEqual([unsent]);
  });

  it("drops someone who signed up when clearing their token failed", () => {
    expect(invitedNotSignedUp([request()], [{ email: "ana@example.test" }])).toEqual([]);
  });

  it.each(["pending", "denied"] as const)("leaves out a %s request", (status) => {
    expect(invitedNotSignedUp([request({ status })], [])).toEqual([]);
  });
});
