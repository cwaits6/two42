import { describe, expect, it } from "vitest";
import { applyGenderFilter, genderCounts, GENDER_FILTERS } from "./genderFilter";
import type { Gender } from "@/lib/types";

const people: { id: string; gender: Gender | null }[] = [
  { id: "a", gender: "male" },
  { id: "b", gender: "female" },
  { id: "c", gender: null },
  { id: "d", gender: "female" },
];

describe("gender filter", () => {
  it("counts someone with no gender in All only", () => {
    expect(genderCounts(people)).toEqual({ all: 4, male: 1, female: 2 });
    expect(applyGenderFilter(people, "male").map((p) => p.id)).toEqual(["a"]);
    expect(applyGenderFilter(people, "female").map((p) => p.id)).toEqual(["b", "d"]);
  });

  it("shows as many people as each option's count", () => {
    const counts = genderCounts(people);
    for (const { value } of GENDER_FILTERS) {
      expect(applyGenderFilter(people, value)).toHaveLength(counts[value]);
    }
  });
});
