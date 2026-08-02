/**
 * Import planner (CWA-40). planImport() is a PURE function from parsed rows
 * plus an org snapshot to a validated ImportPlan — no IO, no await, no
 * client. All matching, ambiguity detection, role-escalation blocking, and
 * household resolution happen here, which makes "validate every row before
 * writing any of them" the natural shape and the export→import no-op a unit
 * test instead of an integration test.
 *
 * Tenancy: MemberRow has no org_id field (parseMembers hard-fails on the
 * column) and no PlannedWrite payload ever carries one — inserts rely on the
 * column DEFAULT public.app_current_org_id(), the fail-closed resolver.
 *
 * Write paths (profiles has NO INSERT policy — a CSV row cannot become a
 * profile):
 *   matched profile            → UPDATE profiles
 *   new person, has_login=true → hard row error (LOGIN_CREATE_UNSUPPORTED)
 *   new person, has_login=false→ INSERT family_members
 *
 * Why v1 cannot create logins: the invite row an import would write is an
 * `access_requests` row with status='approved' and a signup_token, and
 * access_requests has exactly one INSERT policy — "Anyone can submit access
 * request" — whose WITH CHECK requires status='pending' and NULL for
 * reviewed_by, reviewed_at, signup_token, token_expires_at and
 * approved_role. There is no admin INSERT policy, so every such insert fails
 * RLS. Planning it as a row error keeps the failure inside "validate
 * everything before writing anything"; attempting the write instead would
 * 500 the run *after* households, family members and profile updates had
 * already landed. An admin-scoped INSERT policy is the follow-up (it also
 * fixes invite-bulk, which issues the same insert and is broken today).
 */
import type { HiddenFieldToken, MemberRow } from "@/lib/members/format";
import { HIDDEN_FIELD_COLUMNS, HIDDEN_FIELD_TOKENS } from "@/lib/members/format";
import type {
  OrgSnapshot,
  SnapshotFamilyMember,
  SnapshotProfile,
} from "@/lib/members/snapshot";
import type { FamilyMemberRelationship, UserRole } from "@/lib/types";

export type RowAction =
  | "create_family_member"
  | "update_profile"
  | "update_family_member"
  | "no_change"
  | "error";

export type ImportErrorCode =
  | "AMBIGUOUS_MATCH"
  | "AMBIGUOUS_HOUSEHOLD"
  | "UNKNOWN_GROUP"
  | "ROLE_ESCALATION"
  | "HAS_LOGIN_CHANGE"
  | "LOGIN_CREATE_UNSUPPORTED"
  | "MISSING_REQUIRED"
  | "INVALID_EMAIL"
  | "INVALID_DATE"
  | "INVALID_BIRTH_PART"
  | "INVALID_RELATIONSHIP"
  | "INVALID_ROLE"
  | "DUPLICATE_IN_FILE"
  | "MISSING_HOUSEHOLD_NAME";

export interface RowError {
  code: ImportErrorCode;
  field?: string;
  message: string;
}

export interface RowResult {
  /** 1-based data-row number, matches the file. */
  line: number;
  action: RowAction;
  matchedBy?: "email" | "household_name_birth";
  /** field → [old, new] */
  changes?: Record<string, [unknown, unknown]>;
  warnings: string[];
  errors: RowError[];
}

/** Profile columns import may update. Deliberately excludes id, org_id,
 *  email (the match key), and every column outside the v1 contract. `role`
 *  IS updatable — ordinary transitions flow through here; it is escalation
 *  into or out of 'admin' that planProfileUpdate blocks, not the column. */
export interface ProfileUpdateValues {
  first_name?: string;
  last_name?: string;
  preferred_name?: string;
  phone_mobile?: string;
  phone_home?: string;
  phone_work?: string;
  birth_month?: number;
  birth_day?: number;
  birth_year?: number;
  relationship?: string;
  role?: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  anniversary?: string;
  occupation?: string;
  employer?: string;
  is_unlisted?: boolean;
  email_announcements?: boolean;
  hide_email?: boolean;
  hide_phone_mobile?: boolean;
  hide_phone_home?: boolean;
  hide_phone_work?: boolean;
  hide_address?: boolean;
  hide_birthday?: boolean;
  hide_birth_year?: boolean;
  hide_anniversary?: boolean;
  hide_occupation?: boolean;
}

export interface FamilyMemberInsertValues {
  first_name: string;
  last_name?: string;
  preferred_name?: string;
  birth_month?: number;
  birth_day?: number;
  birth_year?: number;
  relationship: string;
  is_class_member?: boolean;
}

export interface FamilyMemberUpdateValues {
  preferred_name?: string;
  relationship?: string;
  is_class_member?: boolean;
}

export type PlannedWrite =
  | {
      kind: "insert_family_unit";
      line: number;
      /** Per-file synthetic key — resolved to the inserted id at apply time. */
      householdKey: string;
      values: { family_name: string };
    }
  | {
      kind: "insert_family_member";
      line: number;
      /** Exactly one of familyId (existing household) or householdKey
       *  (household planned for insert earlier in this run) is set. */
      familyId: string | null;
      householdKey: string | null;
      values: FamilyMemberInsertValues;
    }
  | {
      kind: "update_family_member";
      line: number;
      id: string;
      values: FamilyMemberUpdateValues;
    }
  | { kind: "update_profile"; line: number; id: string; values: ProfileUpdateValues }
  | {
      kind: "insert_profile_group";
      line: number;
      profileId: string;
      groupId: string;
      isLeader: boolean;
    }
  | {
      kind: "update_profile_group";
      line: number;
      profileId: string;
      groupId: string;
      isLeader: boolean;
    }
  | {
      kind: "delete_profile_group";
      line: number;
      profileId: string;
      groupId: string;
    };

export interface ImportPlan {
  rows: RowResult[];
  summary: {
    rows: number;
    create: number;
    update: number;
    noChange: number;
    error: number;
    householdsCreate: number;
    groupAssignments: number;
  };
  /** Ordered, ready to apply: family_units inserts → family_members
   *  inserts/updates → profiles updates → profile_groups changes. */
  writes: PlannedWrite[];
}

const ROLES: ReadonlySet<string> = new Set<UserRole>([
  "pending",
  "member",
  "content_editor",
  "admin",
]);

const RELATIONSHIPS: ReadonlySet<string> = new Set<FamilyMemberRelationship>([
  "primary",
  "spouse",
  "child",
  "parent",
  "sibling",
  "other",
]);

// Same conservative shape as lib/branding.ts's EMAIL boundary. Not imported
// from there: branding pulls in next/headers via the server client, which
// would make this module untestable in vitest's node environment.
const EMAIL = /^[^\s@<>,;:"\\]+@[^\s@<>,;:"\\]+\.[^\s@<>,;:"\\]+$/;

const ANNIVERSARY = /^(\d{4})-(\d{2})-(\d{2})$/;

const norm = (value: string | null): string => (value ?? "").trim().toLowerCase();

/** Identity key for a person within a household: name + birth triple. */
function personKey(
  firstName: string | null,
  lastName: string | null,
  birthMonth: number | null,
  birthDay: number | null,
  birthYear: number | null
): string {
  return [
    norm(firstName),
    norm(lastName),
    birthMonth ?? "",
    birthDay ?? "",
    birthYear ?? "",
  ].join("\u0000");
}

interface HouseholdResolution {
  familyId: string | null;
  /** Set when the household must be created in this run. */
  pendingKey: string | null;
  householdName: string | null;
  error: RowError | null;
  warnings: string[];
}

export function planImport(rows: MemberRow[], snapshot: OrgSnapshot): ImportPlan {
  // ---- snapshot lookups --------------------------------------------------
  const profilesByEmail = new Map<string, SnapshotProfile[]>();
  for (const profile of snapshot.profiles) {
    if (profile.email === null) continue;
    const key = norm(profile.email);
    profilesByEmail.set(key, [...(profilesByEmail.get(key) ?? []), profile]);
  }
  const familiesByName = new Map<string, { id: string; family_name: string }[]>();
  for (const family of snapshot.families) {
    const key = norm(family.family_name);
    familiesByName.set(key, [...(familiesByName.get(key) ?? []), family]);
  }
  const familyMembersByFamily = new Map<string, SnapshotFamilyMember[]>();
  for (const member of snapshot.familyMembers) {
    familyMembersByFamily.set(member.family_id, [
      ...(familyMembersByFamily.get(member.family_id) ?? []),
      member,
    ]);
  }
  const profilesByFamily = new Map<string, SnapshotProfile[]>();
  for (const profile of snapshot.profiles) {
    if (profile.family_id === null) continue;
    profilesByFamily.set(profile.family_id, [
      ...(profilesByFamily.get(profile.family_id) ?? []),
      profile,
    ]);
  }
  const groupsByName = new Map(snapshot.groups.map((g) => [norm(g.name), g]));
  const membershipsByProfile = new Map<string, Map<string, boolean>>();
  for (const pg of snapshot.profileGroups) {
    const entry = membershipsByProfile.get(pg.profile_id) ?? new Map();
    entry.set(pg.group_id, pg.is_leader);
    membershipsByProfile.set(pg.profile_id, entry);
  }
  const accessRequestEmails = new Set(snapshot.accessRequestEmails);

  // ---- per-row state -----------------------------------------------------
  const results: RowResult[] = rows.map((row) => ({
    line: row.line,
    action: "no_change",
    warnings: [],
    errors: [],
  }));
  const resultByRow = new Map(rows.map((row, i) => [row, results[i]]));
  const fail = (row: MemberRow, error: RowError) => {
    resultByRow.get(row)!.errors.push(error);
  };

  // ---- step 1: row validation -------------------------------------------
  //
  // first_name and email are CREATE preconditions, not row preconditions, so
  // they are checked in the planning branches below rather than here. Both
  // profiles.first_name and profiles.email are nullable and genuinely NULL in
  // the wild, so export writes a blank cell for them — checking them here
  // made an org's own export unimportable, since one bad row 422s the file.
  const currentYear = new Date().getFullYear();
  for (const row of rows) {
    if (row.email !== null && !EMAIL.test(row.email)) {
      fail(row, {
        code: "INVALID_EMAIL",
        field: "email",
        message: "email is not a valid address",
      });
    }
    if (row.relationship !== null && !RELATIONSHIPS.has(row.relationship)) {
      fail(row, {
        code: "INVALID_RELATIONSHIP",
        field: "relationship",
        message: `relationship must be one of: ${[...RELATIONSHIPS].join(", ")}`,
      });
    }
    if (row.role !== null && !ROLES.has(row.role)) {
      fail(row, {
        code: "INVALID_ROLE",
        field: "role",
        message: `role must be one of: ${[...ROLES].join(", ")}`,
      });
    }
    const birthPart = (
      field: "birth_month" | "birth_day" | "birth_year",
      min: number,
      max: number
    ) => {
      const value = row[field];
      if (value === null) return;
      if (Number.isNaN(value) || value < min || value > max) {
        fail(row, {
          code: "INVALID_BIRTH_PART",
          field,
          message: `${field} must be a whole number between ${min} and ${max}`,
        });
      }
    };
    birthPart("birth_month", 1, 12);
    birthPart("birth_day", 1, 31);
    birthPart("birth_year", 1900, currentYear);
    if (row.anniversary !== null) {
      const match = ANNIVERSARY.exec(row.anniversary);
      const valid =
        match !== null &&
        (() => {
          const [, y, m, d] = match;
          const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
          return (
            date.getUTCFullYear() === Number(y) &&
            date.getUTCMonth() === Number(m) - 1 &&
            date.getUTCDate() === Number(d)
          );
        })();
      if (!valid) {
        fail(row, {
          code: "INVALID_DATE",
          field: "anniversary",
          message: "anniversary must be a real date in YYYY-MM-DD form",
        });
      }
    }
  }

  // Household grouping key. Rows that name the same household mean the same
  // household even without an explicit household_key — otherwise a
  // hand-authored file (the primary import use case; only export emits keys)
  // turns a family of four typed a row at a time into four one-person
  // households, and that duplicate state is unrecoverable: it makes every
  // later import of the same file a permanent AMBIGUOUS_HOUSEHOLD and there
  // is no in-app household merge.
  const groupKey = (row: MemberRow): string =>
    row.household_key ??
    (row.household_name !== null
      ? `__name-${norm(row.household_name)}`
      : `__row-${row.line}`);

  // ---- step 2: in-file duplicates ---------------------------------------
  const seenEmails = new Set<string>();
  const seenPeople = new Set<string>();
  for (const row of rows) {
    if (row.email !== null) {
      const key = norm(row.email);
      if (seenEmails.has(key)) {
        fail(row, {
          code: "DUPLICATE_IN_FILE",
          field: "email",
          message: "another row in this file has the same email",
        });
      }
      seenEmails.add(key);
    }
    if (!row.has_login) {
      const key = [
        groupKey(row),
        personKey(
          row.first_name,
          row.last_name,
          row.birth_month,
          row.birth_day,
          row.birth_year
        ),
      ].join("\u0000");
      if (seenPeople.has(key)) {
        fail(row, {
          code: "DUPLICATE_IN_FILE",
          message:
            "another row in this file has the same household, name, and birth date",
        });
      }
      seenPeople.add(key);
    }
  }

  // ---- step 3: profile matching (has_login=true, by email) --------------
  const matchedProfile = new Map<MemberRow, SnapshotProfile>();
  for (const row of rows) {
    if (!row.has_login || row.email === null) continue;
    const matches = profilesByEmail.get(norm(row.email)) ?? [];
    if (matches.length > 1) {
      // profiles.email has no unique constraint (F4) — a multi-match is a
      // first-class row error, never a .single() throw.
      fail(row, {
        code: "AMBIGUOUS_MATCH",
        field: "email",
        message: "more than one existing member has this email",
      });
      continue;
    }
    if (matches.length === 1) matchedProfile.set(row, matches[0]);
  }

  // ---- step 4: household resolution, per household group ----------------
  const keyGroups = new Map<string, MemberRow[]>();
  for (const row of rows) {
    const key = groupKey(row);
    keyGroups.set(key, [...(keyGroups.get(key) ?? []), row]);
  }

  const resolutions = new Map<string, HouseholdResolution>();
  for (const [key, groupRows] of keyGroups) {
    const resolution: HouseholdResolution = {
      familyId: null,
      pendingKey: null,
      householdName: null,
      error: null,
      warnings: [],
    };
    resolutions.set(key, resolution);

    // A matched person's existing household is authoritative — reusing their
    // family_id (never re-parenting them) is what makes round-trip a no-op.
    const matchedFamilyIds = new Set(
      groupRows
        .map((row) => matchedProfile.get(row)?.family_id ?? null)
        .filter((id): id is string => id !== null)
    );
    if (matchedFamilyIds.size > 1) {
      resolution.error = {
        code: "AMBIGUOUS_HOUSEHOLD",
        field: "household_key",
        message:
          "rows sharing this household_key match existing members from different households",
      };
      continue;
    }
    if (matchedFamilyIds.size === 1) {
      resolution.familyId = [...matchedFamilyIds][0];
      continue;
    }

    // Household fields come from the household_primary row; if none is
    // flagged, the first row for the group wins (with a warning when the
    // group has more than one row — a singleton is the normal case, not a
    // mistake). `group` names the key only when the file supplied one:
    // groupKey()'s `__name-` synthetic embeds the household name, and a
    // household name is a member fact.
    const primaryRows = groupRows.filter((row) => row.household_primary);
    const authoritative = primaryRows[0] ?? groupRows[0];
    const group = isFileHouseholdKey(key)
      ? `household_key "${key}"`
      : "the same household_name";
    if (groupRows.length > 1 && primaryRows.length === 0) {
      resolution.warnings.push(
        `no row is flagged household_primary for ${group}; using the first row`
      );
    }
    const nameConflicts = groupRows.some(
      (row) => norm(row.household_name) !== norm(authoritative.household_name)
    );
    if (nameConflicts) {
      // Names the disagreeing FIELD, and the admin-chosen household_key when
      // there is one — never household_name's value, which is a member fact.
      // The guarantee is scoped to this response body (which import/route.ts
      // permits to carry member data); do not route these to console.*.
      resolution.warnings.push(
        `rows sharing ${group} disagree on: household_name (using the ${
          primaryRows.length > 0 ? "household_primary" : "first"
        } row's value)`
      );
    }

    const householdName = authoritative.household_name;
    resolution.householdName = householdName;
    if (householdName === null) {
      // Only an error for rows that actually need a household (family_members
      // require one); resolved per row below.
      continue;
    }
    const nameMatches = familiesByName.get(norm(householdName)) ?? [];
    if (nameMatches.length > 1) {
      resolution.error = {
        code: "AMBIGUOUS_HOUSEHOLD",
        field: "household_name",
        message: "more than one existing household has this name",
      };
      continue;
    }
    if (nameMatches.length === 1) {
      resolution.familyId = nameMatches[0].id;
      continue;
    }
    resolution.pendingKey = key;
  }

  // ---- step 5: family_member matching (has_login=false) -----------------
  const matchedFamilyMember = new Map<MemberRow, SnapshotFamilyMember>();
  for (const row of rows) {
    if (row.has_login) continue;
    const resolution = resolutions.get(groupKey(row))!;
    if (resolution.error !== null || resolution.familyId === null) continue;
    const candidates = (
      familyMembersByFamily.get(resolution.familyId) ?? []
    ).filter(
      (member) =>
        personKey(
          member.first_name,
          member.last_name,
          member.birth_month,
          member.birth_day,
          member.birth_year
        ) ===
        personKey(
          row.first_name,
          row.last_name,
          row.birth_month,
          row.birth_day,
          row.birth_year
        )
    );
    if (candidates.length > 1) {
      fail(row, {
        code: "AMBIGUOUS_MATCH",
        message:
          "more than one existing family member in this household has the same name and birth date",
      });
      continue;
    }
    if (candidates.length === 1) matchedFamilyMember.set(row, candidates[0]);
  }

  // ---- steps 5-8: per-row planning ---------------------------------------
  const familyUnitInserts: PlannedWrite[] = [];
  const familyMemberWrites: PlannedWrite[] = [];
  const profileUpdates: PlannedWrite[] = [];
  const profileGroupWrites: PlannedWrite[] = [];
  const plannedHouseholds = new Set<string>();
  const plannedHouseholdKeyByName = new Map<string, string>();
  let groupAssignments = 0;

  const ensureHouseholdInsert = (
    row: MemberRow,
    resolution: HouseholdResolution
  ): void => {
    // Two groups that name the same NEW household share one insert, even when
    // the file gave them distinct household_keys. family_units.family_name has
    // no unique constraint, so nothing downstream would stop the duplicate —
    // and a duplicate name is exactly the state that makes name-based
    // household resolution a permanent AMBIGUOUS_HOUSEHOLD with no in-app
    // merge to undo it. One run must not manufacture that.
    const name = norm(resolution.householdName);
    const existing = plannedHouseholdKeyByName.get(name);
    if (existing !== undefined) {
      resolution.pendingKey = existing;
      return;
    }
    const key = resolution.pendingKey!;
    plannedHouseholdKeyByName.set(name, key);
    if (plannedHouseholds.has(key)) return;
    plannedHouseholds.add(key);
    familyUnitInserts.push({
      kind: "insert_family_unit",
      line: row.line,
      householdKey: key,
      values: { family_name: resolution.householdName! },
    });
  };

  for (const row of rows) {
    const result = resultByRow.get(row)!;
    const resolution = resolutions.get(groupKey(row))!;
    for (const message of resolution.warnings) {
      if (!result.warnings.includes(message)) result.warnings.push(message);
    }

    // Validation errors from earlier steps stop this row before planning.
    if (result.errors.length > 0) {
      result.action = "error";
      continue;
    }

    if (row.has_login) {
      const profile = matchedProfile.get(row);
      if (profile !== undefined) {
        planProfileUpdate(row, result, profile);
        continue;
      }

      // profiles.email is nullable, so export emits has_login=true rows with
      // a blank email cell. Email is the only match key a login-holder has,
      // so such a row can neither be matched nor created — but erroring would
      // 422 the whole file and make the org's own export unimportable. Do
      // nothing, and say why.
      if (row.email === null) {
        result.action = "no_change";
        result.warnings.push(
          "no email on this row, so an existing member with a login cannot be matched; edit them on the members page"
        );
        continue;
      }

      // has_login flipped? The person may exist as a family_member.
      if (resolution.error === null && resolution.familyId !== null) {
        const shadow = (
          familyMembersByFamily.get(resolution.familyId) ?? []
        ).some(
          (member) =>
            personKey(
              member.first_name,
              member.last_name,
              member.birth_month,
              member.birth_day,
              member.birth_year
            ) ===
            personKey(
              row.first_name,
              row.last_name,
              row.birth_month,
              row.birth_day,
              row.birth_year
            )
        );
        if (shadow) {
          fail(row, {
            code: "HAS_LOGIN_CHANGE",
            field: "has_login",
            message:
              "this person exists as a family member without a login; promoting them is a deliberate in-app action, not an import",
          });
          result.action = "error";
          continue;
        }
      }

      // Already invited (any access_requests status) — the same dedupe
      // invite-bulk performs. A no_change rather than the error below,
      // because the admin's intent is already recorded upstream.
      if (accessRequestEmails.has(norm(row.email))) {
        result.action = "no_change";
        result.warnings.push(
          "an invite or access request already exists for this email; skipped"
        );
        continue;
      }

      // v1 cannot create a login. See the module header: the approved
      // access_requests row an invite needs violates the table's only INSERT
      // policy, so attempting it would 500 mid-apply after households,
      // family members and profile updates had already been written.
      // Failing here keeps that inside validation, where the contract is
      // "nothing applies unless everything validates".
      fail(row, {
        code: "LOGIN_CREATE_UNSUPPORTED",
        field: "has_login",
        message:
          "import cannot create a new member with a login; invite them from the members page, then re-import to fill in their details",
      });
      result.action = "error";
      continue;
    }

    // ---- has_login=false: family_members paths --------------------------
    // first_name is required on this path for both create and match:
    // family_members.first_name is NOT NULL, and a blank one cannot form the
    // personKey that matches an existing family member either.
    if (row.first_name === null) {
      fail(row, {
        code: "MISSING_REQUIRED",
        field: "first_name",
        message: "first_name is required for a member without a login",
      });
      result.action = "error";
      continue;
    }

    if (row.email !== null && (profilesByEmail.get(norm(row.email)) ?? []).length > 0) {
      fail(row, {
        code: "HAS_LOGIN_CHANGE",
        field: "has_login",
        message:
          "this email belongs to an existing member with a login; has_login cannot be changed by an import",
      });
      result.action = "error";
      continue;
    }

    if (resolution.error !== null) {
      fail(row, resolution.error);
      result.action = "error";
      continue;
    }

    const member = matchedFamilyMember.get(row);
    if (member !== undefined) {
      planFamilyMemberUpdate(row, result, member);
      continue;
    }

    // A profile with the same name+birth in this household means the person
    // already has a login — the reverse has_login flip.
    if (resolution.familyId !== null) {
      const shadow = (profilesByFamily.get(resolution.familyId) ?? []).some(
        (profile) =>
          personKey(
            profile.first_name,
            profile.last_name,
            profile.birth_month,
            profile.birth_day,
            profile.birth_year
          ) ===
          personKey(
            row.first_name,
            row.last_name,
            row.birth_month,
            row.birth_day,
            row.birth_year
          )
      );
      if (shadow) {
        fail(row, {
          code: "HAS_LOGIN_CHANGE",
          field: "has_login",
          message:
            "this person exists as a member with a login; has_login cannot be changed by an import",
        });
        result.action = "error";
        continue;
      }
    }

    if (resolution.familyId === null && resolution.pendingKey === null) {
      fail(row, {
        code: "MISSING_HOUSEHOLD_NAME",
        field: "household_name",
        message:
          "a family member without a login needs a household_name to create or join a household",
      });
      result.action = "error";
      continue;
    }

    if (row.groups.length > 0) {
      result.warnings.push(
        "groups are ignored for family members without a login"
      );
    }
    if (resolution.pendingKey !== null) ensureHouseholdInsert(row, resolution);
    result.action = "create_family_member";
    const values: FamilyMemberInsertValues = {
      first_name: row.first_name!,
      relationship: row.relationship ?? "other",
    };
    if (row.last_name !== null) values.last_name = row.last_name;
    if (row.preferred_name !== null) values.preferred_name = row.preferred_name;
    if (row.birth_month !== null) values.birth_month = row.birth_month;
    if (row.birth_day !== null) values.birth_day = row.birth_day;
    if (row.birth_year !== null) values.birth_year = row.birth_year;
    if (row.is_class_member !== null) values.is_class_member = row.is_class_member;
    familyMemberWrites.push({
      kind: "insert_family_member",
      line: row.line,
      familyId: resolution.familyId,
      householdKey: resolution.pendingKey,
      values,
    });
  }

  // ---- helpers used above ------------------------------------------------
  function planProfileUpdate(
    row: MemberRow,
    result: RowResult,
    profile: SnapshotProfile
  ): void {
    result.matchedBy = "email";
    const changes: Record<string, [unknown, unknown]> = {};
    const values: ProfileUpdateValues = {};

    // Blank means "not provided", never "clear this field": a field enters
    // the diff only when the row supplies a non-empty value that differs.
    const diffString = (
      field:
        | "first_name"
        | "last_name"
        | "preferred_name"
        | "phone_mobile"
        | "phone_home"
        | "phone_work"
        | "relationship"
        | "address_line1"
        | "address_line2"
        | "city"
        | "state"
        | "postal_code"
        | "anniversary"
        | "occupation"
        | "employer"
    ) => {
      const next = row[field];
      if (next === null) return;
      const previous = profile[field];
      if (next === (previous ?? "")) return;
      changes[field] = [previous, next];
      values[field] = next;
    };
    const diffNumber = (field: "birth_month" | "birth_day" | "birth_year") => {
      const next = row[field];
      if (next === null) return;
      if (next === profile[field]) return;
      changes[field] = [profile[field], next];
      values[field] = next;
    };
    const diffBoolean = (field: "is_unlisted" | "email_announcements") => {
      const next = row[field];
      if (next === null) return;
      if (next === profile[field]) return;
      changes[field] = [profile[field], next];
      values[field] = next;
    };

    diffString("first_name");
    diffString("last_name");
    diffString("preferred_name");
    diffString("phone_mobile");
    diffString("phone_home");
    diffString("phone_work");
    diffString("relationship");
    diffString("address_line1");
    diffString("address_line2");
    diffString("city");
    diffString("state");
    diffString("postal_code");
    diffString("anniversary");
    diffString("occupation");
    diffString("employer");
    diffNumber("birth_month");
    diffNumber("birth_day");
    diffNumber("birth_year");
    diffBoolean("is_unlisted");
    diffBoolean("email_announcements");

    // Role rule (G3): equal to stored → no-op, always allowed (that is what
    // keeps export→import a no-op for an existing admin). A change into or
    // out of admin is blocked; other transitions are ordinary updates.
    if (row.role !== null && row.role !== profile.role) {
      if (row.role === "admin" || profile.role === "admin") {
        fail(row, {
          code: "ROLE_ESCALATION",
          field: "role",
          message:
            "an import cannot change a role into or out of admin; use the members page",
        });
        result.action = "error";
        return;
      }
      changes.role = [profile.role, row.role];
      values.role = row.role;
    }

    // Non-empty hidden_fields is the complete hidden set for this person, so
    // all nine flags are diffed; empty means "not provided".
    //
    // The list fields inherit "blank = not provided" from the scalar rule,
    // but with a sharper consequence: a member's LAST hidden flag and LAST
    // group cannot be removed by clearing the cell, and bulk privacy
    // correction is plausibly the main reason to hand-edit this column. That
    // trade-off stands for v1 (a sentinel for "the empty set" is a contract
    // decision, not a patch) — but a silent no-op on an explicit edit is the
    // worst available behavior, so say what was ignored.
    if (
      row.hidden_fields.length === 0 &&
      HIDDEN_FIELD_TOKENS.some((token) => profile[HIDDEN_FIELD_COLUMNS[token]])
    ) {
      result.warnings.push(
        "hidden_fields is blank, which means \"not provided\" — this member's existing hidden fields were left as they are"
      );
    }
    if (row.hidden_fields.length > 0) {
      const desired = new Set<HiddenFieldToken>(row.hidden_fields);
      for (const token of HIDDEN_FIELD_TOKENS) {
        const column = HIDDEN_FIELD_COLUMNS[token];
        const next = desired.has(token);
        if (next === profile[column]) continue;
        changes[column] = [profile[column], next];
        values[column] = next;
      }
    }

    // Non-empty groups is the authoritative membership set for this person;
    // blank is "not provided" — see the hidden_fields note above.
    const groupWrites: PlannedWrite[] = [];
    if (
      row.groups.length === 0 &&
      (membershipsByProfile.get(profile.id)?.size ?? 0) > 0
    ) {
      result.warnings.push(
        'groups is blank, which means "not provided" — this member\'s existing group memberships were left as they are'
      );
    }
    if (row.groups.length > 0) {
      const desired = new Map<string, boolean>();
      let unknown = false;
      for (const name of row.groups) {
        const group = groupsByName.get(norm(name));
        if (group === undefined) {
          fail(row, {
            code: "UNKNOWN_GROUP",
            field: "groups",
            message: `no group named "${name}" exists; create it first`,
          });
          unknown = true;
          continue;
        }
        desired.set(group.id, row.leads.some((lead) => norm(lead) === norm(name)));
      }
      if (unknown) {
        result.action = "error";
        return;
      }
      const current = membershipsByProfile.get(profile.id) ?? new Map();
      for (const [id, isLeader] of desired) {
        if (!current.has(id)) {
          groupWrites.push({
            kind: "insert_profile_group",
            line: row.line,
            profileId: profile.id,
            groupId: id,
            isLeader,
          });
          groupAssignments += 1;
        } else if (current.get(id) !== isLeader) {
          groupWrites.push({
            kind: "update_profile_group",
            line: row.line,
            profileId: profile.id,
            groupId: id,
            isLeader,
          });
        }
      }
      for (const id of current.keys()) {
        if (!desired.has(id)) {
          groupWrites.push({
            kind: "delete_profile_group",
            line: row.line,
            profileId: profile.id,
            groupId: id,
          });
        }
      }
    }

    if (Object.keys(changes).length === 0 && groupWrites.length === 0) {
      result.action = "no_change";
      return;
    }
    result.action = Object.keys(changes).length > 0 ? "update_profile" : "no_change";
    result.changes = Object.keys(changes).length > 0 ? changes : undefined;
    if (Object.keys(values).length > 0) {
      profileUpdates.push({
        kind: "update_profile",
        line: row.line,
        id: profile.id,
        values,
      });
    }
    if (groupWrites.length > 0 && result.action === "no_change") {
      // Group-only changes still count as an update for the summary.
      result.action = "update_profile";
    }
    profileGroupWrites.push(...groupWrites);
  }

  function planFamilyMemberUpdate(
    row: MemberRow,
    result: RowResult,
    member: SnapshotFamilyMember
  ): void {
    result.matchedBy = "household_name_birth";
    const changes: Record<string, [unknown, unknown]> = {};
    const values: FamilyMemberUpdateValues = {};
    if (
      row.preferred_name !== null &&
      row.preferred_name !== (member.preferred_name ?? "")
    ) {
      changes.preferred_name = [member.preferred_name, row.preferred_name];
      values.preferred_name = row.preferred_name;
    }
    if (row.relationship !== null && row.relationship !== member.relationship) {
      changes.relationship = [member.relationship, row.relationship];
      values.relationship = row.relationship;
    }
    if (
      row.is_class_member !== null &&
      row.is_class_member !== member.is_class_member
    ) {
      changes.is_class_member = [member.is_class_member, row.is_class_member];
      values.is_class_member = row.is_class_member;
    }
    if (row.groups.length > 0) {
      result.warnings.push(
        "groups are ignored for family members without a login"
      );
    }
    if (Object.keys(changes).length === 0) {
      result.action = "no_change";
      return;
    }
    result.action = "update_family_member";
    result.changes = changes;
    familyMemberWrites.push({
      kind: "update_family_member",
      line: row.line,
      id: member.id,
      values,
    });
  }

  // ---- summary + write ordering -----------------------------------------
  const summary = {
    rows: rows.length,
    create: 0,
    update: 0,
    noChange: 0,
    error: 0,
    householdsCreate: familyUnitInserts.length,
    groupAssignments,
  };
  for (const result of results) {
    if (result.errors.length > 0) result.action = "error";
    switch (result.action) {
      case "create_family_member":
        summary.create += 1;
        break;
      case "update_profile":
      case "update_family_member":
        summary.update += 1;
        break;
      case "no_change":
        summary.noChange += 1;
        break;
      case "error":
        summary.error += 1;
        break;
    }
  }

  // With any row error the plan is unappliable by contract (the route
  // returns 422 before writing), but emit no writes at all so the invariant
  // is structural rather than a route-level discipline.
  const writes: PlannedWrite[] =
    summary.error > 0
      ? []
      : [
          ...familyUnitInserts,
          ...familyMemberWrites,
          ...profileUpdates,
          ...profileGroupWrites,
        ];

  return { rows: results, summary, writes };
}

/** True when the key came from the file's household_key column, not one of
 *  the synthetics groupKey() derives (`__name-` / `__row-`). Only a real key
 *  is worth naming back to the admin in a warning. */
function isFileHouseholdKey(key: string): boolean {
  return !key.startsWith("__row-") && !key.startsWith("__name-");
}
