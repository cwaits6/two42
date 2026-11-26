import { formatEventDate, formatEventTime } from "@/lib/time/zone";
import { SUPPER_FORMATS, type SupperFormat } from "./shuffle";

export { partyName } from "@/supabase/functions/_shared/supper-labels";

// Each value set below is the CHECK constraint on its column in the supper
// club migration; the type and the options derive from the one tuple.
export const ROTATION_STATUSES = ["draft", "open", "published", "ended"] as const;
export type RotationStatus = (typeof ROTATION_STATUSES)[number];

export const REPEAT_KINDS = ["weeks", "monthly_weekday"] as const;
export type RepeatKind = (typeof REPEAT_KINDS)[number];

export const REPLY_STATUSES = ["going", "not_going"] as const;
export type ReplyStatus = (typeof REPLY_STATUSES)[number];

function oneOf<T extends string>(values: readonly T[], value: string): value is T {
  return (values as readonly string[]).includes(value);
}

export function isRotationStatus(value: string): value is RotationStatus {
  return oneOf(ROTATION_STATUSES, value);
}

export function isRepeatKind(value: string): value is RepeatKind {
  return oneOf(REPEAT_KINDS, value);
}

export function isReplyStatus(value: string): value is ReplyStatus {
  return oneOf(REPLY_STATUSES, value);
}

export const FORMAT_LABELS: Record<SupperFormat, string> = {
  same_table_one_host: "Same table, one host",
  same_table_rotating: "Same table, hosts take turns",
  new_tables: "New tables each supper",
};

export const FORMAT_HELP: Record<SupperFormat, string> = {
  same_table_one_host: "Tables stay the same for the whole rotation. Each table has one host for every supper.",
  same_table_rotating: "Tables stay the same for the whole rotation. The parties at each table take turns hosting.",
  new_tables: "New tables for every supper, from the hosts free that night.",
};

export const FORMAT_OPTIONS = SUPPER_FORMATS.map((value) => ({
  value,
  label: FORMAT_LABELS[value],
}));

export const STATUS_LABELS: Record<RotationStatus, string> = {
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

export const REPLY_LABELS: Record<ReplyStatus, string> = {
  going: "Going",
  not_going: "Not going",
};

export const REPLY_OPTIONS = REPLY_STATUSES.map((value) => ({ value, label: REPLY_LABELS[value] }));

export const LENGTH_OPTIONS = [
  { value: "months", label: "Number of months" },
  { value: "end", label: "End date" },
];

// The CHECK constraint on suppers.length_minutes.
export const SUPPER_LENGTHS = [90, 120, 150, 180, 210, 240] as const;

/** "2½ hours" for 150 minutes. */
export function supperLengthLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  return minutes % 60 === 30 ? `${hours}½ hours` : `${hours} ${hours === 1 ? "hour" : "hours"}`;
}

export const SUPPER_LENGTH_OPTIONS = SUPPER_LENGTHS.map((value) => ({
  value: String(value),
  label: supperLengthLabel(value),
}));

/** The UTC instant a supper ends: its start plus its length. */
export function supperEndsAt(startsAt: string, minutes: number): string {
  return new Date(new Date(startsAt).getTime() + minutes * 60_000).toISOString();
}

export function isSupperFormat(value: string): value is SupperFormat {
  return oneOf(SUPPER_FORMATS, value);
}

/** "Every 4 weeks on Saturday" or "2nd Saturday of each month". */
export function howOftenLabel(rotation: {
  repeat_kind: string;
  repeat_weeks: number | null;
  repeat_week_of_month: number | null;
  weekday: number;
}): string {
  const day = WEEKDAY_OPTIONS[rotation.weekday]?.label ?? "";
  if (rotation.repeat_kind === "weeks") {
    const n = rotation.repeat_weeks ?? 1;
    return n === 1 ? `Every week on ${day}` : `Every ${n} weeks on ${day}`;
  }
  const nth = WEEK_OF_MONTH_OPTIONS.find((o) => o.value === String(rotation.repeat_week_of_month))?.label ?? "";
  return `${nth} ${day} of each month`;
}

/** "Saturday, January 9, 2027 at 6:00 PM" in the church's zone. */
export function supperWhen(iso: string, zone: string): string {
  return `${formatEventDate(iso, zone)} at ${formatEventTime(iso, zone)}`;
}

/** Whether a supper still takes replies and changes: its rotation is running and it has not started. */
export function supperOpen(status: RotationStatus, startsAt: string, now: Date): boolean {
  return status === "published" && new Date(startsAt).getTime() > now.getTime();
}
