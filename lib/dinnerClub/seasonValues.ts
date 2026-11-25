import type { RepeatKind } from "./labels";
import type { DinnerFormat } from "./shuffle";

export interface SeasonValues {
  title: string;
  format: DinnerFormat;
  startsOn: string;
  lengthMode: "months" | "end";
  lengthMonths: string;
  endsOn: string;
  repeatKind: RepeatKind;
  repeatWeeks: string;
  weekOfMonth: string;
  weekday: string;
  startTime: string;
  sizeMin: string;
  sizeMax: string;
  closesOn: string;
  backToBack: boolean;
  /** Hosts say what each guest party brings. */
  bringList: boolean;
}

export const NEW_SEASON: SeasonValues = {
  title: "",
  format: "same_table_one_host",
  startsOn: "",
  lengthMode: "months",
  lengthMonths: "4",
  endsOn: "",
  repeatKind: "weeks",
  repeatWeeks: "4",
  weekOfMonth: "2",
  weekday: "6",
  startTime: "18:00",
  sizeMin: "6",
  sizeMax: "8",
  closesOn: "",
  backToBack: false,
  bringList: true,
};

type SeasonRow = {
  title: string;
  format: DinnerFormat;
  starts_on: string;
  ends_on: string;
  length_months: number | null;
  repeat_kind: string;
  repeat_weeks: number | null;
  repeat_week_of_month: number | null;
  weekday: number;
  default_start_time: string;
  table_size_min: number;
  table_size_max: number;
  signup_closes_on: string;
  allow_back_to_back_hosting: boolean;
  bring_list_enabled: boolean;
};

/** A saved season as the form's values. */
export function valuesFromSeason(row: SeasonRow): SeasonValues {
  return {
    title: row.title,
    format: row.format,
    startsOn: row.starts_on,
    lengthMode: row.length_months ? "months" : "end",
    lengthMonths: String(row.length_months ?? 4),
    endsOn: row.ends_on,
    repeatKind: row.repeat_kind === "monthly_weekday" ? "monthly_weekday" : "weeks",
    repeatWeeks: String(row.repeat_weeks ?? 4),
    weekOfMonth: String(row.repeat_week_of_month ?? 2),
    weekday: String(row.weekday),
    startTime: row.default_start_time.slice(0, 5),
    sizeMin: String(row.table_size_min),
    sizeMax: String(row.table_size_max),
    closesOn: row.signup_closes_on,
    backToBack: row.allow_back_to_back_hosting,
    bringList: row.bring_list_enabled,
  };
}

function addDays(day: string, days: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

/**
 * The next season's values from an ended one: the same format, how often,
 * table size and settings, starting the day after it ended and running as
 * long. The title and sign-up close date are the leader's to set.
 */
export function nextSeasonValues(previous: SeasonRow): SeasonValues {
  const values = valuesFromSeason(previous);
  const startsOn = addDays(previous.ends_on, 1);
  return {
    ...values,
    title: "",
    startsOn,
    endsOn: values.lengthMode === "end" ? addDays(startsOn, daysBetween(previous.starts_on, previous.ends_on)) : "",
    closesOn: "",
  };
}
