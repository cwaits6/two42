import { describe, expect, it } from "vitest";
import { emailOutcome, movedNotice, publishedNotice } from "./emailOutcome";

describe("emailOutcome", () => {
  it("is unsent when a send failed, the cap refused the batch, or the send threw", () => {
    expect(emailOutcome({ sent: 3, failed: 0, capped: false }).unsent).toBe(false);
    expect(emailOutcome({ sent: 2, failed: 1, capped: false }).unsent).toBe(true);
    expect(emailOutcome({ sent: 0, failed: 0, capped: true }).unsent).toBe(true);
    expect(emailOutcome(null)).toEqual({ sent: 0, capped: false, unsent: true });
  });
});

describe("movedNotice", () => {
  it("only succeeds when everyone at the table was emailed", () => {
    expect(movedNotice("Dinner moved.", emailOutcome({ sent: 4, failed: 0, capped: false }))).toEqual({
      kind: "success",
      text: "Dinner moved.",
    });
    expect(movedNotice("Dinner moved.", emailOutcome({ sent: 3, failed: 1, capped: false })).kind).toBe("warning");
    expect(movedNotice("Date moved.", emailOutcome(null)).text).toContain("Let the table know");
    expect(movedNotice("Dinner moved.", emailOutcome({ sent: 0, failed: 0, capped: true })).text).toContain("email limit");
  });
});

describe("publishedNotice", () => {
  it("counts the people emailed, not the people whose tables changed", () => {
    expect(publishedNotice({ changed: 5, ...emailOutcome({ sent: 4, failed: 0, capped: false }) }).text).toBe(
      "Tables published. 4 people were emailed."
    );
  });

  it("warns when emails did not go out", () => {
    expect(publishedNotice({ changed: 5, ...emailOutcome({ sent: 0, failed: 0, capped: true }) }).kind).toBe("warning");
    expect(publishedNotice({ changed: 5, ...emailOutcome(null) }).kind).toBe("warning");
  });

  it("says so when no one's table changed", () => {
    expect(publishedNotice({ changed: 0, ...emailOutcome({ sent: 0, failed: 0, capped: false }) }).text).toBe(
      "Tables published. No one's table changed."
    );
  });
});
