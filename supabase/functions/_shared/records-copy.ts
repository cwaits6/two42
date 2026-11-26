// What copying one person from the church's records changes in two42, worked
// out without any I/O so the app's Refresh now and the nightly run apply the
// same rules. The database's member-edit triggers
// (20261209000000_church_records_copy.sql) are the other half: they turn a
// member's edit or clear into a "changed" or "cleared" state, which these
// rules then leave alone.
import { MAX_NAME_LENGTH, MAX_SUFFIX_LENGTH, MAX_TITLE_LENGTH, titleCaseName } from "./name-case.ts";
import type { RecordsCopyPerson, RecordsDate, RecordsPhone } from "./records-types.ts";

/** The fields a church admin chooses a setting for, named as two42 names them. */
export const RECORDS_FIELDS = [
  "name",
  "suffix",
  "title",
  "gender",
  "phone_mobile",
  "phone_work",
  "birthday",
  "anniversary",
  "photo",
  "grade",
] as const;

export type RecordsField = (typeof RECORDS_FIELDS)[number];

/** Only identity fields can be locked; contact details, dates and the photo stay the member's to change. */
export const LOCKABLE_FIELDS: readonly RecordsField[] = ["name", "suffix", "title", "gender", "grade"];

export type FieldMode = "locked" | "member";

/** The preferred name follows the name's setting, is filled from the nick name and is never locked. */
export type ValueField = RecordsField | "preferred_name";

export const VALUE_STATES = ["records", "changed", "cleared"] as const;
export type ValueState = (typeof VALUE_STATES)[number];

type Cell = string | number | null;
export type Columns = Record<string, Cell>;

/** The two42 columns each field fills. */
export const FIELD_COLUMNS: Record<ValueField, readonly string[]> = {
  name: ["first_name", "last_name"],
  preferred_name: ["preferred_name"],
  suffix: ["suffix"],
  title: ["title"],
  gender: ["gender"],
  phone_mobile: ["phone_mobile"],
  phone_work: ["phone_work"],
  birthday: ["birth_month", "birth_day", "birth_year"],
  anniversary: ["anniversary_month", "anniversary_day", "anniversary_year"],
  photo: ["avatar_url"],
  grade: ["graduation_year"],
};

/** Which row each field lives on: the profile, the household, or the person's own household member row. */
export const FIELD_TABLE: Record<ValueField, "profile" | "household" | "grade"> = {
  name: "profile",
  preferred_name: "profile",
  suffix: "profile",
  title: "profile",
  gender: "profile",
  phone_mobile: "profile",
  phone_work: "profile",
  birthday: "profile",
  anniversary: "household",
  photo: "profile",
  grade: "grade",
};

/** The profile columns a copy reads and may write. Never the email. */
export const PROFILE_COPY_COLUMNS = [
  "first_name",
  "last_name",
  "preferred_name",
  "title",
  "suffix",
  "gender",
  "phone_mobile",
  "phone_work",
  "birth_month",
  "birth_day",
  "birth_year",
  "avatar_url",
] as const;

export interface CurrentValues {
  profile: Columns;
  /** The household's anniversary columns, or null when the person has no household. */
  household: Columns | null;
  /** The person's own household member row, or null when there is none to hold a grade. */
  grade: Columns | null;
}

export interface StoredValue {
  state: ValueState;
  /** The church's value when it was last read, by two42 column; a photo also keeps its token under "photo". */
  churchValue: Columns;
}

export type ValueRow = {
  field: ValueField;
  state: ValueState;
  church_value: Columns;
};

export interface CopyPlan {
  profile: Columns;
  household: Columns;
  grade: Columns;
  values: ValueRow[];
  /** A value went from empty to filled, so the member is told once. */
  filled: boolean;
  /** The photo token to download, when the plan wants the church's photo and none was passed in. */
  photoWanted: string | null;
}

export interface CopyInput {
  settings: ReadonlyMap<RecordsField, FieldMode>;
  current: CurrentValues;
  stored: ReadonlyMap<ValueField, StoredValue>;
  person: RecordsCopyPerson;
  normalizePhone: (raw: string) => string | null;
  /** The church's photo once stored in two42, for the token the plan asked for. */
  storedPhoto?: { token: string; url: string } | null;
  today?: Date;
}

const blank = (value: Cell | undefined) => value === null || value === undefined || value === "";

export function isEmptyValue(value: Columns): boolean {
  return Object.values(value).every(blank);
}

function pick(row: Columns, columns: readonly string[]): Columns {
  return Object.fromEntries(columns.map((c) => [c, blank(row[c]) ? null : row[c]]));
}

export function sameValue(a: Columns, b: Columns, columns: readonly string[]): boolean {
  return columns.every((c) => (blank(a[c]) ? null : a[c]) === (blank(b[c]) ? null : b[c]));
}

function affix(value: string | null, max: number): string | null {
  const text = value?.trim() ?? "";
  return text && text.length <= max ? text : null;
}

function phone(value: RecordsPhone | null, normalizePhone: CopyInput["normalizePhone"]): string | null {
  if (!value) return null;
  return normalizePhone(`+${value.countryCode || "1"}${value.number}`);
}

/** Month and day as every date form requires them; a year only from 1900 to this one. */
function dateColumns(date: RecordsDate, prefix: string, today: Date): Columns {
  const empty = { [`${prefix}_month`]: null, [`${prefix}_day`]: null, [`${prefix}_year`]: null };
  const { month, day, year } = date;
  if (!month || !day || month < 1 || month > 12) return empty;
  const yearOk = year !== null && year >= 1900 && year <= today.getFullYear();
  if (day < 1 || day > new Date(yearOk ? year : 2000, month, 0).getDate()) return empty;
  return { [`${prefix}_month`]: month, [`${prefix}_day`]: day, [`${prefix}_year`]: yearOk ? year : null };
}

/**
 * The church's value for each field, normalized exactly as the forms save it,
 * so a member saving an unchanged form doesn't look like an edit. A value that
 * can't be saved counts as empty; a name missing its first or last part is
 * left out, since two42 needs both.
 */
export function churchValues(
  person: RecordsCopyPerson,
  normalizePhone: CopyInput["normalizePhone"],
  today: Date = new Date(),
): Partial<Record<ValueField, Columns>> {
  const first = titleCaseName(person.firstName);
  const last = titleCaseName(person.lastName);
  const nick = titleCaseName(person.nickName);
  const nameOk = !!first && !!last && first.length <= MAX_NAME_LENGTH && last.length <= MAX_NAME_LENGTH;
  const grade = person.graduationYear;
  return {
    ...(nameOk
      ? {
          name: { first_name: first, last_name: last },
          // Rock fills the nick name with the first name when none is given, which isn't a preferred name.
          preferred_name: {
            preferred_name: nick && nick !== first && nick.length <= MAX_NAME_LENGTH ? nick : null,
          },
        }
      : {}),
    suffix: { suffix: affix(person.suffix, MAX_SUFFIX_LENGTH) },
    title: { title: affix(person.title, MAX_TITLE_LENGTH) },
    gender: { gender: person.gender },
    phone_mobile: { phone_mobile: phone(person.mobile, normalizePhone) },
    phone_work: { phone_work: phone(person.work, normalizePhone) },
    birthday: dateColumns(person.birthday, "birth", today),
    anniversary: dateColumns(person.anniversary, "anniversary", today),
    grade: { graduation_year: grade !== null && grade >= 2000 && grade <= 2100 ? grade : null },
  };
}

function settingOf(settings: CopyInput["settings"], field: ValueField): FieldMode | undefined {
  if (field === "preferred_name") return settings.has("name") ? "member" : undefined;
  return settings.get(field);
}

export function planPersonCopy(input: CopyInput): CopyPlan {
  const { settings, current, stored, person } = input;
  const plan: CopyPlan = { profile: {}, household: {}, grade: {}, values: [], filled: false, photoWanted: null };
  const church = churchValues(person, input.normalizePhone, input.today);

  const rowFor = (field: ValueField): Columns | null => {
    const table = FIELD_TABLE[field];
    return table === "profile" ? current.profile : table === "household" ? current.household : current.grade;
  };
  const write = (field: ValueField, value: Columns) => {
    Object.assign(plan[FIELD_TABLE[field]], value);
  };
  const record = (field: ValueField, state: ValueState, churchValue: Columns) => {
    plan.values.push({ field, state, church_value: churchValue });
  };

  const fields: ValueField[] = [...RECORDS_FIELDS, "preferred_name"];
  for (const field of fields) {
    const mode = settingOf(settings, field);
    if (!mode) continue;
    if (field === "photo") {
      planPhoto(input, plan);
      continue;
    }
    const value = church[field];
    const row = rowFor(field);
    if (!value || !row) continue;
    const columns = FIELD_COLUMNS[field];
    const now = pick(row, columns);
    const prior = stored.get(field);
    const equal = sameValue(now, value, columns);

    if (mode === "locked") {
      if (!equal) write(field, value);
      if (!equal && isEmptyValue(now) && !prior) plan.filled = true;
      record(field, "records", value);
      continue;
    }

    if (!prior) {
      if (isEmptyValue(value)) continue;
      if (equal) {
        record(field, "records", value);
      } else if (isEmptyValue(now)) {
        write(field, value);
        record(field, "records", value);
        plan.filled = true;
      } else if (field !== "preferred_name") {
        // Turning a field on never replaces what a member already entered; it offers the church's value instead.
        record(field, "changed", value);
      }
      continue;
    }

    if (prior.state === "records") {
      if (!equal) write(field, value);
      record(field, "records", value);
    } else if (prior.state === "changed" && equal && !isEmptyValue(now)) {
      record(field, "records", value);
    } else {
      // The member's own value, or their clear, stays; only what the church holds is kept up to date.
      record(field, prior.state, value);
    }
  }
  return plan;
}

// The photo is the member's: a member's own upload is never replaced, and the
// church's photo is stored in two42 rather than linked, so it is downloaded
// only when the plan would show it.
function planPhoto(input: CopyInput, plan: CopyPlan) {
  const token = input.person.photo;
  const avatar = input.current.profile.avatar_url ?? null;
  const prior = input.stored.get("photo");
  const stored = input.storedPhoto && input.storedPhoto.token === token ? input.storedPhoto : null;

  if (!prior) {
    if (!token || !blank(avatar)) return;
    if (!stored) {
      plan.photoWanted = token;
      return;
    }
    plan.profile.avatar_url = stored.url;
    plan.values.push({ field: "photo", state: "records", church_value: { photo: token, avatar_url: stored.url } });
    plan.filled = true;
    return;
  }

  const priorToken = prior.churchValue.photo ?? null;
  if (prior.state !== "records") {
    const churchValue = priorToken === token ? prior.churchValue : { photo: token, avatar_url: null };
    plan.values.push({ field: "photo", state: prior.state, church_value: churchValue });
    return;
  }
  if (!token) {
    if (!blank(avatar)) plan.profile.avatar_url = null;
    plan.values.push({ field: "photo", state: "records", church_value: { photo: null, avatar_url: null } });
    return;
  }
  if (priorToken === token) {
    plan.values.push({ field: "photo", state: "records", church_value: prior.churchValue });
    return;
  }
  if (!stored) {
    plan.photoWanted = token;
    plan.values.push({ field: "photo", state: "records", church_value: prior.churchValue });
    return;
  }
  plan.profile.avatar_url = stored.url;
  plan.values.push({ field: "photo", state: "records", church_value: { photo: token, avatar_url: stored.url } });
}

/** Whether the plan changes anything in two42. */
export function planWrites(plan: CopyPlan): boolean {
  return Object.keys(plan.profile).length + Object.keys(plan.household).length + Object.keys(plan.grade).length > 0;
}
