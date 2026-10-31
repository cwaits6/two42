import { describe, expect, it } from "vitest";
import { failureMessage, operatorMessage } from "./errorCopy";

describe("failureMessage", () => {
  it("names what failed and says to try again", () => {
    expect(failureMessage("save the fund")).toBe("Couldn't save the fund. Try again.");
    expect(failureMessage("save the fund", 500)).toBe("Couldn't save the fund. Try again.");
  });

  it("gives the next step for a dropped connection, a lost session, a refusal and a rate limit", () => {
    expect(failureMessage("save the fund", "network")).toBe(
      "Couldn't save the fund. Check your connection and try again."
    );
    expect(failureMessage("save the fund", 401)).toBe("Couldn't save the fund. Sign in again, then try again.");
    expect(failureMessage("save the fund", 403)).toBe("Couldn't save the fund. You don't have permission to do that.");
    expect(failureMessage("save the fund", 429)).toBe("Couldn't save the fund. Wait a minute, then try again.");
  });

  it("uses the caller's sentence for a status its route gives a meaning of its own", () => {
    const known = { 409: "Someone just signed up for that date." };
    expect(failureMessage("sign you up", 409, known)).toBe("Someone just signed up for that date.");
    expect(failureMessage("sign you up", 500, known)).toBe("Couldn't sign you up. Try again.");
  });
});

describe("operatorMessage", () => {
  it("shows the API's sentence for a 400 or 409", () => {
    expect(operatorMessage(400, { error: "Enter a valid owner email address." }, "Fallback.")).toBe(
      "Enter a valid owner email address."
    );
    expect(operatorMessage(409, { error: "Already taken." }, "Fallback.")).toBe("Already taken.");
  });

  it("uses the fixed copy for auth and server failures", () => {
    expect(operatorMessage(401, { error: "Unauthorized" }, "Fallback.")).toBe("Fallback.");
    expect(operatorMessage(500, { error: "Failed to update organization" }, "Fallback.")).toBe("Fallback.");
  });

  it("uses the fixed copy when the body has no usable message", () => {
    expect(operatorMessage(400, null, "Fallback.")).toBe("Fallback.");
    expect(operatorMessage(400, { error: 42 }, "Fallback.")).toBe("Fallback.");
  });
});
