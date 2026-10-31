import { describe, expect, it } from "vitest";
import { operatorMessage } from "./operatorMessage";

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
