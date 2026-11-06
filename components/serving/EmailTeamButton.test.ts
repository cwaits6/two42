import { describe, expect, it } from "vitest";
import { emailReachCopy } from "./EmailTeamButton";

describe("emailReachCopy", () => {
  it("names the number the server counted", () => {
    expect(emailReachCopy(3)).toEqual({
      everyone: "Everyone on the team (3 members)",
      send: "Send to 3 members",
      nobody: false,
    });
    expect(emailReachCopy(1)).toEqual({
      everyone: "Everyone on the team (1 member)",
      send: "Send to 1 member",
      nobody: false,
    });
  });

  it("names no number when the count could not be read", () => {
    expect(emailReachCopy(null)).toEqual({ everyone: "Everyone on the team", send: "Send", nobody: false });
  });

  it("says nobody can get email for a counted zero, never for a count that failed", () => {
    expect(emailReachCopy(0).nobody).toBe(true);
    expect(emailReachCopy(null).nobody).toBe(false);
  });
});
