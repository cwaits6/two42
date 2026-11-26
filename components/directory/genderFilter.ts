import type { Gender } from "@/lib/types";

export type GenderFilter = "all" | Gender;

export const GENDER_FILTERS: readonly { value: GenderFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
];

type WithGender = { gender: Gender | null };

/** Someone with no gender is in All only, never in Male or Female. */
export function applyGenderFilter<T extends WithGender>(people: readonly T[], filter: GenderFilter): T[] {
  return filter === "all" ? [...people] : people.filter((p) => p.gender === filter);
}

export function genderCounts(people: readonly WithGender[]): Record<GenderFilter, number> {
  return {
    all: people.length,
    male: applyGenderFilter(people, "male").length,
    female: applyGenderFilter(people, "female").length,
  };
}
