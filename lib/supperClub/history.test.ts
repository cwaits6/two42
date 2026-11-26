import { describe, expect, it } from "vitest";
import { pastPairsFromHistory } from "./history";

const keys = (pairs: [string, string][]) => pairs.map(([a, b]) => `${a}|${b}`).sort();

describe("pastPairsFromHistory", () => {
  it("names this rotation's parties by the people who shared a past table", () => {
    const current = [
      { id: "P", profileIds: ["henry", "chloe"] },
      { id: "Q", profileIds: ["isaac"] },
      { id: "R", profileIds: ["leo"] },
    ];
    expect(keys(pastPairsFromHistory(current, [[["henry", "chloe"], ["isaac"]], [["leo"]]]))).toEqual(["P|Q"]);
  });

  it("does not pair a couple who sign up apart for having been one party", () => {
    const current = [
      { id: "P", profileIds: ["henry"] },
      { id: "Q", profileIds: ["chloe"] },
    ];
    expect(pastPairsFromHistory(current, [[["henry", "chloe"]]])).toEqual([]);
  });

  it("never pairs a party with itself", () => {
    const current = [{ id: "P", profileIds: ["henry", "isaac"] }];
    expect(pastPairsFromHistory(current, [[["henry"], ["isaac"]]])).toEqual([]);
  });

  it("counts every rotation it is given and leaves out people not signed up now", () => {
    const current = [
      { id: "P", profileIds: ["henry"] },
      { id: "Q", profileIds: ["isaac"] },
      { id: "R", profileIds: ["leo"] },
    ];
    const lastRotation = [[["henry"], ["zoe"]]];
    const rotationBefore = [[["isaac"], ["leo"]], [["henry"], ["ruth"]]];
    expect(keys(pastPairsFromHistory(current, [...lastRotation, ...rotationBefore]))).toEqual(["Q|R"]);
  });
});
