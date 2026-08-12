/**
 * The v1 member CSV column contract (CWA-40). Pure: strings and plain data
 * in, strings and plain data out — no IO, no framework imports. MemberRow is
 * the WIRE type, deliberately separate from Profile in lib/types.ts: it
 * describes one row of the file, not one row of a table (one person may live
 * in profiles, family_members, or — as a planned invite — access_requests).
 *
 * org_id is structurally unrepresentable here: it is not a column, not a
 * MemberRow field, and its presence in an uploaded header is a hard
 * file-level error (the one column whose presence means the caller is trying
 * to name a tenant).
 */
import {
  guardCell,
  parseCsv,
  serializeCsv,
  unguardCell,
} from "@/lib/members/csv";
import type { OrgSnapshot, SnapshotProfile } from "@/lib/members/snapshot";

/** Ordered header contract. Column order in an uploaded file is irrelevant;
 *  this order is what export emits and what keeps round trips byte-stable. */
export const MEMBER_CSV_COLUMNS = [
  "first_name",
  "preferred_name",
  "last_name",
  "email",
  "phone_mobile",
  "phone_home",
  "phone_work",
  "birth_month",
  "birth_day",
  "birth_year",
  "relationship",
  "has_login",
  "role",
  "is_class_member",
  "household_key",
  "household_name",
  "household_primary",
  "address_line1",
  "address_line2",
  "city",
  "state",
  "postal_code",
  "anniversary",
  "occupation",
  "employer",
  "is_unlisted",
  "email_announcements",
  "hidden_fields",
  "groups",
  "leads",
] as const;

export type MemberCsvColumn = (typeof MEMBER_CSV_COLUMNS)[number];

/** Headers that must be present in an uploaded file (cells may be blank). */
export const REQUIRED_CSV_COLUMNS: readonly MemberCsvColumn[] = [
  "first_name",
  "last_name",
  "email",
  "has_login",
];

/** The nine hidden_fields tokens in canonical serialization order. */
export const HIDDEN_FIELD_TOKENS = [
  "email",
  "phone_mobile",
  "phone_home",
  "phone_work",
  "address",
  "birthday",
  "birth_year",
  "anniversary",
  "occupation",
] as const;

export type HiddenFieldToken = (typeof HIDDEN_FIELD_TOKENS)[number];

/** Token → profiles.hide_* column. */
export const HIDDEN_FIELD_COLUMNS = {
  email: "hide_email",
  phone_mobile: "hide_phone_mobile",
  phone_home: "hide_phone_home",
  phone_work: "hide_phone_work",
  address: "hide_address",
  birthday: "hide_birthday",
  birth_year: "hide_birth_year",
  anniversary: "hide_anniversary",
  occupation: "hide_occupation",
} as const satisfies Record<HiddenFieldToken, keyof SnapshotProfile>;

/**
 * One data row of the file. Blank cells parse to null (strings/numbers/tri-
 * state booleans) or [] (list cells) — both mean "not provided", never
 * "clear this field".
 *
 * Exactly two columns escape that scheme and collapse to a definite boolean
 * at parse time, because every downstream decision forks on them:
 *   has_login          — blank defaults to "the email cell is non-empty"
 *   household_primary  — blank defaults to false
 * Export always writes both explicitly, so the round-trip test cannot
 * surface the collapse; this list is the only record of it.
 *
 * NaN in a birth part means the cell held a non-integer; the planner reports
 * it as INVALID_BIRTH_PART.
 */
export interface MemberRow {
  /** 1-based data-row number, matching the file (header excluded). */
  line: number;
  first_name: string | null;
  preferred_name: string | null;
  last_name: string | null;
  email: string | null;
  phone_mobile: string | null;
  phone_home: string | null;
  phone_work: string | null;
  birth_month: number | null;
  birth_day: number | null;
  birth_year: number | null;
  relationship: string | null;
  has_login: boolean;
  role: string | null;
  is_class_member: boolean | null;
  household_key: string | null;
  household_name: string | null;
  household_primary: boolean;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  anniversary: string | null;
  occupation: string | null;
  employer: string | null;
  is_unlisted: boolean | null;
  email_announcements: boolean | null;
  /** Canonical-order subset of HIDDEN_FIELD_TOKENS. Non-empty = the complete
   *  set of hidden fields for this person; [] = not provided. */
  hidden_fields: HiddenFieldToken[];
  /** member_groups names. Non-empty = authoritative membership set; [] = not
   *  provided (no group changes). */
  groups: string[];
  /** Subset of `groups` the person leads. */
  leads: string[];
}

export interface FormatWarning {
  /** 1-based data-row number; 0 for header-level warnings. */
  line: number;
  message: string;
}

export type FormatErrorCode =
  | "EMPTY_FILE"
  | "ORG_ID_COLUMN"
  | "MISSING_COLUMN"
  | "UNTERMINATED_QUOTE";

export interface FormatError {
  code: FormatErrorCode;
  message: string;
}

export interface ParseMembersResult {
  rows: MemberRow[];
  warnings: FormatWarning[];
  error?: FormatError;
}

function boolCell(value: boolean | null): string {
  return value === null ? "" : value ? "true" : "false";
}

function intCell(value: number | null): string {
  return value === null || Number.isNaN(value) ? "" : String(value);
}

function rowToCells(row: MemberRow): string[] {
  const cells: Record<MemberCsvColumn, string> = {
    first_name: row.first_name ?? "",
    preferred_name: row.preferred_name ?? "",
    last_name: row.last_name ?? "",
    email: row.email ?? "",
    phone_mobile: row.phone_mobile ?? "",
    phone_home: row.phone_home ?? "",
    phone_work: row.phone_work ?? "",
    birth_month: intCell(row.birth_month),
    birth_day: intCell(row.birth_day),
    birth_year: intCell(row.birth_year),
    relationship: row.relationship ?? "",
    has_login: row.has_login ? "true" : "false",
    role: row.role ?? "",
    is_class_member: boolCell(row.is_class_member),
    household_key: row.household_key ?? "",
    household_name: row.household_name ?? "",
    household_primary: row.household_primary ? "true" : "false",
    address_line1: row.address_line1 ?? "",
    address_line2: row.address_line2 ?? "",
    city: row.city ?? "",
    state: row.state ?? "",
    postal_code: row.postal_code ?? "",
    anniversary: row.anniversary ?? "",
    occupation: row.occupation ?? "",
    employer: row.employer ?? "",
    is_unlisted: boolCell(row.is_unlisted),
    email_announcements: boolCell(row.email_announcements),
    hidden_fields: canonicalHiddenFields(row.hidden_fields).join("|"),
    groups: row.groups.join("|"),
    leads: row.leads.join("|"),
  };
  return MEMBER_CSV_COLUMNS.map((column) => guardCell(cells[column]));
}

/** Reorder/dedupe tokens into HIDDEN_FIELD_TOKENS order so serialization is
 *  stable regardless of input order — otherwise serialize∘parse drifts. */
function canonicalHiddenFields(tokens: readonly string[]): HiddenFieldToken[] {
  const present = new Set(tokens);
  return HIDDEN_FIELD_TOKENS.filter((token) => present.has(token));
}

/** Serialize member rows to CSV text: header row + one line per person. */
export function serializeMembers(rows: MemberRow[]): string {
  return serializeCsv([[...MEMBER_CSV_COLUMNS], ...rows.map(rowToCells)]);
}

const TRUE_WORDS = new Set(["true", "yes", "1"]);
const FALSE_WORDS = new Set(["false", "no", "0"]);

/**
 * Parse uploaded CSV text into MemberRows. File-level errors (unterminated
 * quote, missing required column, org_id column, no data rows) abort the
 * parse; unknown and duplicate headers, ragged rows, and unparseable boolean
 * cells degrade to warnings. Cells go through unguardCell then trim().
 */
export function parseMembers(text: string): ParseMembersResult {
  const warnings: FormatWarning[] = [];
  const { rows: table, unterminatedQuoteLine } = parseCsv(text);

  // Checked before the header: past an unbalanced quote every row boundary is
  // guesswork, and the truncated remainder parses as a valid short row rather
  // than failing. Aborting is the only honest outcome.
  if (unterminatedQuoteLine !== undefined) {
    return {
      rows: [],
      warnings,
      error: {
        code: "UNTERMINATED_QUOTE",
        message: `Unbalanced quote opened on line ${unterminatedQuoteLine} — the rest of the file could not be read. Check for a stray " character.`,
      },
    };
  }

  if (table.length === 0) {
    return {
      rows: [],
      warnings,
      error: { code: "EMPTY_FILE", message: "The file is empty" },
    };
  }

  const header = table[0].map((cell) => unguardCell(cell).trim().toLowerCase());

  // The tenant column is a hard stop, checked before anything else so no
  // data row is ever read from a file that tries to name an org.
  if (header.includes("org_id")) {
    return {
      rows: [],
      warnings,
      error: {
        code: "ORG_ID_COLUMN",
        message:
          "The file must not contain an org_id column — imports always apply to your own organization",
      },
    };
  }

  const known = new Set<string>(MEMBER_CSV_COLUMNS);
  const columnIndex = new Map<MemberCsvColumn, number>();
  header.forEach((name, index) => {
    if (name === "") return;
    if (!known.has(name)) {
      warnings.push({ line: 0, message: `Unknown column "${name}" ignored` });
      return;
    }
    const column = name as MemberCsvColumn;
    if (columnIndex.has(column)) {
      warnings.push({
        line: 0,
        message: `Duplicate column "${name}" ignored (first occurrence wins)`,
      });
      return;
    }
    columnIndex.set(column, index);
  });

  for (const required of REQUIRED_CSV_COLUMNS) {
    if (!columnIndex.has(required)) {
      return {
        rows: [],
        warnings,
        error: {
          code: "MISSING_COLUMN",
          message: `Required column "${required}" is missing`,
        },
      };
    }
  }

  const rows: MemberRow[] = [];
  for (let i = 1; i < table.length; i++) {
    const line = i; // 1-based data-row number
    const raw = table[i];
    if (raw.every((cell) => cell.trim() === "")) continue;

    // A short row reads every missing column as blank, and blank means "not
    // provided" — so a hand-edited row that lost its trailing commas plans as
    // no_change and reports as a success. Say so rather than absorbing it.
    if (raw.length !== table[0].length) {
      warnings.push({
        line,
        message: `Row has ${raw.length} cells but the header has ${table[0].length}; missing cells were read as blank`,
      });
    }

    const cell = (column: MemberCsvColumn): string => {
      const index = columnIndex.get(column);
      if (index === undefined) return "";
      return unguardCell(raw[index] ?? "").trim();
    };
    const str = (column: MemberCsvColumn): string | null => {
      const value = cell(column);
      return value === "" ? null : value;
    };
    const int = (column: MemberCsvColumn): number | null => {
      const value = cell(column);
      if (value === "") return null;
      // Non-integers become NaN, which the planner reports per-row as
      // INVALID_BIRTH_PART — a parse warning would be invisible next to the
      // row report the admin actually reads.
      return /^\d+$/.test(value) ? parseInt(value, 10) : Number.NaN;
    };
    const bool = (
      column: MemberCsvColumn,
      blank: boolean | null
    ): boolean | null => {
      const value = cell(column).toLowerCase();
      if (value === "") return blank;
      if (TRUE_WORDS.has(value)) return true;
      if (FALSE_WORDS.has(value)) return false;
      warnings.push({
        line,
        message: `Unrecognized ${column} value treated as blank (use true/false)`,
      });
      return blank;
    };
    const list = (column: MemberCsvColumn): string[] => {
      return cell(column)
        .split("|")
        .map((part) => part.trim())
        .filter((part) => part !== "");
    };

    const email = str("email");
    const groups = list("groups");
    const leads = list("leads");
    const missingFromGroups = leads.filter((name) => !groups.includes(name));
    if (missingFromGroups.length > 0) {
      // Treated as membership + leadership rather than dropped.
      warnings.push({
        line,
        message: `leads names not listed in groups (${missingFromGroups.join(", ")}) treated as memberships too`,
      });
    }

    const hiddenRaw = list("hidden_fields");
    const knownTokens = new Set<string>(HIDDEN_FIELD_TOKENS);
    const unknownTokens = hiddenRaw.filter((token) => !knownTokens.has(token));
    if (unknownTokens.length > 0) {
      warnings.push({
        line,
        message: `Unknown hidden_fields tokens ignored: ${unknownTokens.join(", ")}`,
      });
    }

    rows.push({
      line,
      first_name: str("first_name"),
      preferred_name: str("preferred_name"),
      last_name: str("last_name"),
      email,
      phone_mobile: str("phone_mobile"),
      phone_home: str("phone_home"),
      phone_work: str("phone_work"),
      birth_month: int("birth_month"),
      birth_day: int("birth_day"),
      birth_year: int("birth_year"),
      relationship: str("relationship"),
      // Blank has_login defaults to "has an email": a hand-built contact
      // list with emails should invite, not silently create family_members.
      has_login: bool("has_login", email !== null) as boolean,
      role: str("role"),
      is_class_member: bool("is_class_member", null),
      household_key: str("household_key"),
      household_name: str("household_name"),
      household_primary: bool("household_primary", false) as boolean,
      address_line1: str("address_line1"),
      address_line2: str("address_line2"),
      city: str("city"),
      state: str("state"),
      postal_code: str("postal_code"),
      anniversary: str("anniversary"),
      occupation: str("occupation"),
      employer: str("employer"),
      is_unlisted: bool("is_unlisted", null),
      email_announcements: bool("email_announcements", null),
      hidden_fields: canonicalHiddenFields(hiddenRaw),
      groups: [...groups, ...missingFromGroups],
      leads,
    });
  }

  if (rows.length === 0) {
    return {
      rows: [],
      warnings,
      error: { code: "EMPTY_FILE", message: "The file has no data rows" },
    };
  }

  return { rows, warnings };
}

/**
 * The export projection: OrgSnapshot → MemberRows in a deterministic order —
 * households by family_name then id, members within a household with the
 * primary first then by last_name/first_name/id, unhoused members last.
 * Determinism is what makes the round-trip no-op test meaningful.
 */
export function memberRowsFromSnapshot(snapshot: OrgSnapshot): MemberRow[] {
  const groupNames = new Map(snapshot.groups.map((g) => [g.id, g.name]));
  const memberships = new Map<string, { name: string; isLeader: boolean }[]>();
  for (const pg of snapshot.profileGroups) {
    const name = groupNames.get(pg.group_id);
    if (name === undefined) continue;
    const entry = memberships.get(pg.profile_id) ?? [];
    entry.push({ name, isLeader: pg.is_leader });
    memberships.set(pg.profile_id, entry);
  }

  const families = [...snapshot.families].sort(
    (a, b) =>
      a.family_name.localeCompare(b.family_name) || a.id.localeCompare(b.id)
  );
  const householdKeys = new Map(families.map((f, i) => [f.id, `hh-${i + 1}`]));

  type Person =
    | { kind: "profile"; profile: SnapshotProfile }
    | { kind: "family_member"; member: OrgSnapshot["familyMembers"][number] };

  const sortPeople = (people: Person[]): Person[] =>
    people.sort((a, b) => {
      const primary = (p: Person) =>
        (p.kind === "profile" ? p.profile.relationship : p.member.relationship) ===
        "primary"
          ? 0
          : 1;
      const last = (p: Person) =>
        (p.kind === "profile" ? p.profile.last_name : p.member.last_name) ?? "";
      const first = (p: Person) =>
        (p.kind === "profile" ? p.profile.first_name : p.member.first_name) ?? "";
      const id = (p: Person) =>
        p.kind === "profile" ? p.profile.id : p.member.id;
      return (
        primary(a) - primary(b) ||
        last(a).localeCompare(last(b)) ||
        first(a).localeCompare(first(b)) ||
        id(a).localeCompare(id(b))
      );
    });

  const rows: MemberRow[] = [];
  const emit = (person: Person, familyId: string | null) => {
    const family = familyId
      ? families.find((f) => f.id === familyId) ?? null
      : null;
    const householdKey = family ? householdKeys.get(family.id) ?? null : null;
    const householdName = family?.family_name ?? null;
    if (person.kind === "profile") {
      const p = person.profile;
      const groupList = (memberships.get(p.id) ?? []).sort((a, b) =>
        a.name.localeCompare(b.name)
      );
      rows.push({
        line: rows.length + 1,
        first_name: p.first_name,
        preferred_name: p.preferred_name,
        last_name: p.last_name,
        email: p.email,
        phone_mobile: p.phone_mobile,
        phone_home: p.phone_home,
        phone_work: p.phone_work,
        birth_month: p.birth_month,
        birth_day: p.birth_day,
        birth_year: p.birth_year,
        relationship: p.relationship,
        // A profile IS a login holder, even when profiles.email is NULL
        // (invite-bulk signups can land without one). Projecting such a row
        // as has_login=false would send it down the family_members path on
        // re-import and hit HAS_LOGIN_CHANGE; the planner instead reports the
        // blank-email row as an unmatchable no_change.
        has_login: true,
        role: p.role,
        is_class_member: null,
        household_key: householdKey,
        household_name: householdName,
        household_primary: family !== null && p.relationship === "primary",
        address_line1: p.address_line1,
        address_line2: p.address_line2,
        city: p.city,
        state: p.state,
        postal_code: p.postal_code,
        anniversary: p.anniversary,
        occupation: p.occupation,
        employer: p.employer,
        is_unlisted: p.is_unlisted,
        email_announcements: p.email_announcements,
        hidden_fields: HIDDEN_FIELD_TOKENS.filter(
          (token) => p[HIDDEN_FIELD_COLUMNS[token]]
        ),
        groups: groupList.map((g) => g.name),
        leads: groupList.filter((g) => g.isLeader).map((g) => g.name),
      });
    } else {
      const m = person.member;
      rows.push({
        line: rows.length + 1,
        first_name: m.first_name,
        preferred_name: m.preferred_name,
        last_name: m.last_name,
        email: null,
        phone_mobile: null,
        phone_home: null,
        phone_work: null,
        birth_month: m.birth_month,
        birth_day: m.birth_day,
        birth_year: m.birth_year,
        relationship: m.relationship,
        has_login: false,
        role: null,
        is_class_member: m.is_class_member,
        household_key: householdKey,
        household_name: householdName,
        household_primary: m.relationship === "primary",
        address_line1: null,
        address_line2: null,
        city: null,
        state: null,
        postal_code: null,
        anniversary: null,
        occupation: null,
        employer: null,
        is_unlisted: null,
        email_announcements: null,
        hidden_fields: [],
        groups: [],
        leads: [],
      });
    }
  };

  for (const family of families) {
    const people: Person[] = [
      ...snapshot.profiles
        .filter((p) => p.family_id === family.id)
        .map((profile): Person => ({ kind: "profile", profile })),
      ...snapshot.familyMembers
        .filter((m) => m.family_id === family.id)
        .map((member): Person => ({ kind: "family_member", member })),
    ];
    for (const person of sortPeople(people)) emit(person, family.id);
  }

  const unhoused = snapshot.profiles
    .filter((p) => p.family_id === null || !householdKeys.has(p.family_id))
    .map((profile): Person => ({ kind: "profile", profile }));
  for (const person of sortPeople(unhoused)) emit(person, null);

  return rows;
}
