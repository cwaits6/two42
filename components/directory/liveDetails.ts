// The directory's live details merged into the rows it already renders, so the
// cards and the Birthdays and Anniversaries lists read live and copied details
// through the same code. Pure, for the tests that hold the two modes alike.
import type { LiveDirectory, LiveDirectoryOn } from "@/lib/integrations/records/livePlan";
import type { DirectoryProfile, FamilyDirectoryFull } from "@/lib/types";
import { isEmptyValue } from "@/supabase/functions/_shared/records-copy";
import { ADDRESS_COLUMNS } from "@/supabase/functions/_shared/records-households";

const empty = (month: number | null, day: number | null) => !month || !day;

/**
 * With no live details the rows come back as the very same arrays, so a church
 * that doesn't show any sees no change. A live value fills only a detail still
 * empty in these rows: they can be read after a member's edit the live answer
 * was planned before.
 */
export function applyLiveDetails(
  members: DirectoryProfile[],
  families: FamilyDirectoryFull[],
  live: LiveDirectory | null,
): { members: DirectoryProfile[]; families: FamilyDirectoryFull[] } {
  if (!live || live.mode === "off") return { members, families };
  return {
    members: members.map((member) => {
      const birthday = live.people[member.id]?.birthday;
      return birthday?.state === "shown" && empty(member.birth_month, member.birth_day)
        ? { ...member, birth_month: birthday.value.month, birth_day: birthday.value.day }
        : member;
    }),
    families: families.map((family) => {
      const slots = live.households[family.id] ?? {};
      const address = slots.address?.state === "shown" && isEmptyValue(Object.fromEntries(ADDRESS_COLUMNS.map((c) => [c, family[c]]))) ? slots.address : undefined;
      const anniversary =
        slots.anniversary?.state === "shown" && empty(family.anniversary_month, family.anniversary_day) ? slots.anniversary : undefined;
      const children = family.family_members_list.map((child) => {
        const slot = live.children[child.id] ?? {};
        const birthday = slot.birthday?.state === "shown" && empty(child.birth_month, child.birth_day) ? slot.birthday : undefined;
        const grade = slot.grade?.state === "shown" && child.graduation_year === null ? slot.grade : undefined;
        if (!birthday && !grade) return child;
        return {
          ...child,
          ...(birthday ? { birth_month: birthday.value.month, birth_day: birthday.value.day } : {}),
          ...(grade ? { graduation_year: grade.value } : {}),
        };
      });
      if (!address && !anniversary && children.every((c, i) => c === family.family_members_list[i])) {
        return family;
      }
      return {
        ...family,
        ...(address ? address.value : {}),
        ...(anniversary
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
