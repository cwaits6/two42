import { formatEventDate, formatEventTime } from "@/lib/time/zone";
import { DINNER_FORMATS, type DinnerFormat } from "./shuffle";

export { partyName } from "@/supabase/functions/_shared/dinner-labels";

// Each value set below is the CHECK constraint on its column in the dinner
// club migration; the type and the options derive from the one tuple.
export const SEASON_STATUSES = ["draft", "open", "published", "ended"] as const;
export type SeasonStatus = (typeof SEASON_STATUSES)[number];

export const REPEAT_KINDS = ["weeks", "monthly_weekday"] as const;
export type RepeatKind = (typeof REPEAT_KINDS)[number];

export const REPLY_STATUSES = ["going", "not_going"] as const;
export type ReplyStatus = (typeof REPLY_STATUSES)[number];

function oneOf<T extends string>(values: readonly T[], value: string): value is T {
  return (values as readonly string[]).includes(value);
}

export function isSeasonStatus(value: string): value is SeasonStatus {
  return oneOf(SEASON_STATUSES, value);
}

export function isRepeatKind(value: string): value is RepeatKind {
  return oneOf(REPEAT_KINDS, value);
}

export function isReplyStatus(value: string): value is ReplyStatus {
  return oneOf(REPLY_STATUSES, value);
}

export const FORMAT_LABELS: Record<DinnerFormat, string> = {
  same_table_one_host: "Same table, one host",
  same_table_rotating: "Same table, hosts take turns",
  new_tables: "New tables each dinner",
};

export const FORMAT_HELP: Record<DinnerFormat, string> = {
  same_table_one_host: "Tables stay the same all season. Each table has one host for every dinner.",
  same_table_rotating: "Tables stay the same all season. The parties at each table take turns hosting.",
  new_tables: "New tables for every dinner, from the hosts free that night.",
};

export const FORMAT_OPTIONS = DINNER_FORMATS.map((value) => ({
  value,
  label: FORMAT_LABELS[value],
}));

export const STATUS_LABELS: Record<SeasonStatus, string> = {
  draft: "Draft",
  open: "Sign-ups open",
  published: "Tables published",
  ended: "Ended",
};

export const WEEKDAY_OPTIONS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map(
  (label, value) => ({ value: String(value), label })
);

export const WEEK_OF_MONTH_OPTIONS = [
  { value: "1", label: "1st" },
  { value: "2", label: "2nd" },
  { value: "3", label: "3rd" },
  { value: "4", label: "4th" },
  { value: "5", label: "Last" },
];

const REPEAT_LABELS: Record<RepeatKind, string> = {
  weeks: "Every few weeks",
  monthly_weekday: "Monthly",
};

export const REPEAT_OPTIONS = REPEAT_KINDS.map((value) => ({ value, label: REPEAT_LABELS[value] }));

const REPLY_LABELS: Record<ReplyStatus, string> = {
  going: "Going",
  not_going: "Not going",
};

export const REPLY_OPTIONS = REPLY_STATUSES.map((value) => ({ value, label: REPLY_LABELS[value] }));

export const LENGTH_OPTIONS = [
  { value: "months", label: "Number of months" },
  { value: "end", label: "End date" },
];

export function isDinnerFormat(value: string): value is DinnerFormat {
  return oneOf(DINNER_FORMATS, value);
}

/** "Every 4 weeks on Saturday" or "2nd Saturday of each month". */
export function howOftenLabel(season: {
  repeat_kind: string;
  repeat_weeks: number | null;
  repeat_week_of_month: number | null;
  weekday: number;
}): string {
  const day = WEEKDAY_OPTIONS[season.weekday]?.label ?? "";
  if (season.repeat_kind === "weeks") {
    const n = season.repeat_weeks ?? 1;
    return n === 1 ? `Every week on ${day}` : `Every ${n} weeks on ${day}`;
  }
  const nth = WEEK_OF_MONTH_OPTIONS.find((o) => o.value === String(season.repeat_week_of_month))?.label ?? "";
  return `${nth} ${day} of each month`;
}


/** "Saturday, January 9, 2027 at 6:00 PM" in the church's zone. */
export function dinnerWhen(iso: string, zone: string): string {
  return `${formatEventDate(iso, zone)} at ${formatEventTime(iso, zone)}`;
}
