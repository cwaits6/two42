import type { DinnerFormat } from "./shuffle";

export type SeasonStatus = "draft" | "open" | "published" | "ended";

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

export const FORMAT_OPTIONS = (Object.keys(FORMAT_LABELS) as DinnerFormat[]).map((value) => ({
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

export const REPEAT_OPTIONS = [
  { value: "weeks", label: "Every few weeks" },
  { value: "monthly_weekday", label: "Monthly" },
];

export const LENGTH_OPTIONS = [
  { value: "months", label: "Number of months" },
  { value: "end", label: "End date" },
];

export function isDinnerFormat(value: string): value is DinnerFormat {
  return value in FORMAT_LABELS;
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

/** "Henry and Chloe" from the names of a party's one or two people. */
export function partyName(names: string[]): string {
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : (names[0] ?? "");
}
