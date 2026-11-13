import { describe, expect, it } from "vitest";
import { rankUsage, sumUsage, usagePeriod } from "./usage";

const view = (pattern: string, total: number) => ({ kind: "view", pattern, total });
const error = (pattern: string, total: number) => ({ kind: "error", pattern, total });

describe("rankUsage", () => {
  it("shows 5 and more as a number and anything under 5 as fewer than 5", () => {
    const { views } = rankUsage([view("/a", 5), view("/b", 4), view("/c", 1)]);
    expect(views).toEqual([
      { pattern: "/a", shown: "5" },
      { pattern: "/b", shown: "fewer than 5" },
      { pattern: "/c", shown: "fewer than 5" },
    ]);
  });

  it("ranks shown counts most first, and hidden ones after them by pattern so the order hides their value", () => {
    const { views } = rankUsage([view("/z", 1), view("/b", 12), view("/y", 4), view("/a", 1200), view("/c", 12)]);
    expect(views.map((row) => row.pattern)).toEqual(["/a", "/b", "/c", "/y", "/z"]);
    expect(views[0].shown).toBe("1,200");
  });

  it("keeps views and errors apart", () => {
    const ranked = rankUsage([view("/a", 9), error("/a", 6)]);
    expect(ranked).toEqual({ views: [{ pattern: "/a", shown: "9" }], errors: [{ pattern: "/a", shown: "6" }] });
  });
});

describe("sumUsage", () => {
  it("adds churches together before anything is hidden", () => {
    const total = sumUsage([[view("/a", 3), error("/a", 1)], [view("/a", 3)]]);
    expect(rankUsage(total)).toEqual({
      views: [{ pattern: "/a", shown: "6" }],
      errors: [{ pattern: "/a", shown: "fewer than 5" }],
    });
  });
});

describe("usagePeriod", () => {
  it("takes 7, 30 or 90 days and falls back to 30", () => {
    expect([usagePeriod("7"), usagePeriod("90"), usagePeriod("30")]).toEqual([7, 90, 30]);
    expect([usagePeriod(undefined), usagePeriod("365"), usagePeriod(["7", "90"]), usagePeriod("x")]).toEqual([
      30, 30, 30, 30,
    ]);
  });
});
