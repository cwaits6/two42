import type { FamilyDirectoryFull } from "@/lib/types";

// A claimed household record carries the name of someone with an account. The
// view keeps it even when that profile is missing from `members`, and nothing
// in the row says why: the person is hidden from the directory, pending, moved
// out of the household, or outside the viewer's groups. So a claimed record is
// shown, named or searched only when its profile is in `members`.

function claimedButNotVisible(
  family: FamilyDirectoryFull,
  fm: FamilyDirectoryFull["family_members_list"][number],
): boolean {
  return !!fm.claimed_profile_id && !family.members.some((m) => m.id === fm.claimed_profile_id);
}

/** The spouse a household can be named with. */
export function nameableSpouse(family: FamilyDirectoryFull) {
  return (
    family.members.find((m) => m.relationship === "spouse") ||
    family.family_members_list.find(
      (fm) => fm.relationship === "spouse" && !claimedButNotVisible(family, fm),
    )
  );
}

/** Everyone a household may be found by: visible profiles and people without an account. */
export function searchablePeople(family: FamilyDirectoryFull) {
  return [
    ...family.members,
    ...family.family_members_list.filter((fm) => !fm.claimed_profile_id),
  ];
}

/**
 * False when every person in the household is someone the viewer can't see.
 * The database already leaves out a household whose members with an account
 * are all hidden, so a person without an account here belongs to a household
 * with someone listed, outside the viewer's groups or pending, or with no one
 * who has an account.
 */
export function hasPeopleToShow(family: FamilyDirectoryFull): boolean {
  return family.members.length > 0 || family.family_members_list.some((fm) => !fm.claimed_profile_id);
}
