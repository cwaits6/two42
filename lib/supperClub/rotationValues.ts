import { addDays, daysBetween, endFromMonths } from "./dates";
import type { RepeatKind } from "./labels";
import { rotationTitle } from "./rotationTitle";
import type { SupperFormat } from "./shuffle";

export interface RotationValues {
  title: string;
  format: SupperFormat;
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

export const NEW_ROTATION: RotationValues = {
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

type RotationRow = {
  title: string;
  format: SupperFormat;
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

/** A saved rotation as the form's values. */
export function valuesFromRotation(row: RotationRow): RotationValues {
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

/**
 * The next rotation's values from an ended one: the same format, how often,
 * table size and settings, starting the day after its end date and running as
 * long. The sign-up close date is the leader's to set; the title comes from
 * the new dates.
 */
export function nextRotationValues(previous: RotationRow): RotationValues {
  const values = valuesFromRotation(previous);
  const startsOn = addDays(previous.ends_on, 1);
  return {
    ...values,
    title: "",
    startsOn,
    endsOn: values.lengthMode === "end" ? addDays(startsOn, daysBetween(previous.starts_on, previous.ends_on)) : "",
    closesOn: "",
  };
}

/** The longest rotation in months; the database holds the same bound. */
export const MAX_LENGTH_MONTHS = 24;

/** The rotation's last day; empty until the start and a length in range are set. */
export function endsOnOf(v: RotationValues): string {
  if (v.lengthMode === "end") return v.endsOn;
  const months = Number(v.lengthMonths);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.startsOn) || !Number.isInteger(months) || months < 1 || months > MAX_LENGTH_MONTHS) {
    return "";
  }
  return endFromMonths(v.startsOn, months);
}

const DATE_KEYS: readonly (keyof RotationValues)[] = ["startsOn", "lengthMode", "lengthMonths", "endsOn"];

/** The form's values, and whether the title still follows the dates. */
export interface RotationDraft {
  values: RotationValues;
  titleFollowsDates: boolean;
}

/**
 * One field change. Until the leader types a title, date changes fill it in;
 * after that they leave it alone. Emptying the title hands it back to the
 * dates on their next change, not at once, so it never refills under the
 * leader's cursor.
 */
export function changeRotation<K extends keyof RotationValues>(
  draft: RotationDraft,
  key: K,
  value: RotationValues[K],
  takenTitles: readonly string[],
): RotationDraft {
  const values = { ...draft.values, [key]: value };
  if (key === "title") return { values, titleFollowsDates: String(value).trim() === "" };
  if (!draft.titleFollowsDates || !DATE_KEYS.includes(key)) return { ...draft, values };
  return { ...draft, values: { ...values, title: rotationTitle(values.startsOn, endsOnOf(values), takenTitles) } };
}

/** Fills a title the leader emptied from the current dates, for when they leave the field or save. */
export function settleTitle(draft: RotationDraft, takenTitles: readonly string[]): RotationDraft {
  const { values } = draft;
  if (!draft.titleFollowsDates || values.title.trim() !== "") return draft;
  return { ...draft, values: { ...values, title: rotationTitle(values.startsOn, endsOnOf(values), takenTitles) } };
}
