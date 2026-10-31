import { GROUP_DEFAULT_COLOR } from "@/lib/groups/calendar";
import type { ActiveGroup } from "@/lib/groups/active";

/**
 * A group's color is its calendar's, which only its members can read. For a
 * group the viewer is not in, the default color stands in.
 */
export function groupColor(
  groupId: string,
  memberships: readonly Pick<ActiveGroup, "id" | "color">[]
): string {
  return memberships.find((g) => g.id === groupId)?.color ?? GROUP_DEFAULT_COLOR;
}
