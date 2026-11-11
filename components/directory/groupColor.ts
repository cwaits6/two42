import { HEX } from "@/lib/contrast";
import { GROUP_DEFAULT_COLOR } from "@/lib/groups/calendar";

/**
 * A group's color as `discoverable_groups()` returns it: its calendar's, or
 * the default when it has none. The value reaches CSS, so it passes HEX.
 */
export function groupColor(color: string | null): string {
  return color !== null && HEX.test(color) ? color : GROUP_DEFAULT_COLOR;
}
