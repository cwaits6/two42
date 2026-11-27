// The directory's live details merged into the rows it already renders, so the
// cards and the Birthdays and Anniversaries lists read live and copied details
// through the same code. Pure, for the tests that hold the two modes alike.
import type { LiveDirectory, LiveDirectoryOn } from "@/lib/integrations/records/livePlan";
import type { DirectoryProfile, FamilyDirectoryFull } from "@/lib/types";

/** With no live details the rows come back as the very same arrays, so a church that doesn't show any sees no change. */
export function applyLiveDetails(
  members: DirectoryProfile[],
  families: FamilyDirectoryFull[],
  live: LiveDirectory | null,
): { members: DirectoryProfile[]; families: FamilyDirectoryFull[] } {
  if (!live || live.mode === "off") return { members, families };
  return {
    members: members.map((member) => {
      const birthday = live.people[member.id]?.birthday;
      return birthday?.state === "shown"
        ? { ...member, birth_month: birthday.value.month, birth_day: birthday.value.day }
        : member;
    }),
    families: families.map((family) => {
      const { address, anniversary } = live.households[family.id] ?? {};
      const children = family.family_members_list.map((child) => {
        const { birthday, grade } = live.children[child.id] ?? {};
        if (birthday?.state !== "shown" && grade?.state !== "shown") return child;
        return {
          ...child,
          ...(birthday?.state === "shown" ? { birth_month: birthday.value.month, birth_day: birthday.value.day } : {}),
          ...(grade?.state === "shown" ? { graduation_year: grade.value } : {}),
        };
      });
      if (address?.state !== "shown" && anniversary?.state !== "shown" && children.every((c, i) => c === family.family_members_list[i])) {
        return family;
      }
      return {
        ...family,
        ...(address?.state === "shown" ? address.value : {}),
        ...(anniversary?.state === "shown"
          ? {
              anniversary_month: anniversary.value.month,
              anniversary_day: anniversary.value.day,
              anniversary_year: anniversary.value.year,
            }
          : {}),
        family_members_list: children,
      };
    }),
  };
}

/** Whether any of this kind of date from the church's records couldn't be read. */
export function someUnavailable(live: LiveDirectoryOn | null, kind: "birthday" | "anniversary"): boolean {
  if (!live) return false;
  if (live.unavailable) return true;
  if (kind === "anniversary") return Object.values(live.households).some((h) => h.anniversary?.state === "unavailable");
  return [...Object.values(live.people), ...Object.values(live.children)].some((p) => p.birthday?.state === "unavailable");
}
