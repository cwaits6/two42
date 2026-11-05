import { describe, expect, it } from "vitest";
import { landingFor } from "@/lib/landing";

describe("landingFor", () => {
  it("sends an operator who belongs to no church to Platform", () => {
    expect(landingFor(null, true)).toBe("platform");
  });

  it("keeps a pending person on the waiting screen", () => {
    expect(landingFor({ role: "pending" }, false)).toBe("waiting");
    expect(landingFor(null, false)).toBe("waiting");
  });

  it("sends an operator who also belongs to a church to Home", () => {
    expect(landingFor({ role: "member" }, true)).toBe("home");
    expect(landingFor({ role: "admin" }, true)).toBe("home");
  });

  it("keeps an operator whose church has not approved them on the waiting screen", () => {
    expect(landingFor({ role: "pending" }, true)).toBe("waiting");
  });

  it("sends a member to Home", () => {
    expect(landingFor({ role: "member" }, false)).toBe("home");
  });
});
