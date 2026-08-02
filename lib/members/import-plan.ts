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
 *   new person, has_login=true → INSERT access_requests (approved invite)
 *   new person, has_login=false→ INSERT family_members
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
  | "create_invite"
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
 *  email (the match key), role escalations (planner-blocked), and every
 *  column outside the v1 contract. */
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
  | { kind: "insert_access_request"; line: number; email: string; name: string }
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
   *  inserts/updates → profiles updates → access_requests inserts →
   *  profile_groups changes. */
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
  const currentYear = new Date().getFullYear();
  for (const row of rows) {
    if (row.first_name === null) {
      fail(row, {
        code: "MISSING_REQUIRED",
        field: "first_name",
        message: "first_name is required",
      });
    }
    if (row.has_login && row.email === null) {
      fail(row, {
        code: "MISSING_REQUIRED",
        field: "email",
        message: "email is required when has_login is true",
      });
    }
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
        row.household_key ?? `__row-${row.line}`,
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

  // ---- step 4: household resolution, per household_key group ------------
  const groupKey = (row: MemberRow): string =>
    row.household_key ?? `__row-${row.line}`;
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
    // flagged, the first row for the key wins (with a warning when the group
    // has more than one row — a singleton is the normal case, not a mistake).
    const primaryRows = groupRows.filter((row) => row.household_primary);
    const authoritative = primaryRows[0] ?? groupRows[0];
    if (
      isFileHouseholdKey(key) &&
      groupRows.length > 1 &&
      primaryRows.length === 0
    ) {
      resolution.warnings.push(
        `no row is flagged household_primary for household_key "${key}"; using the first row`
      );
    }
    const nameConflicts = groupRows.some(
      (row) => norm(row.household_name) !== norm(authoritative.household_name)
    );
    if (nameConflicts) {
      // Field names only — never the values (they are PII).
      resolution.warnings.push(
        `rows sharing household_key "${key}" disagree on: household_name (using the ${
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
  const accessRequestInserts: PlannedWrite[] = [];
  const profileGroupWrites: PlannedWrite[] = [];
  const plannedHouseholds = new Set<string>();
  let groupAssignments = 0;

  const ensureHouseholdInsert = (
    row: MemberRow,
    resolution: HouseholdResolution
  ): void => {
    const key = resolution.pendingKey!;
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

      if (accessRequestEmails.has(norm(row.email!))) {
        result.action = "no_change";
        result.warnings.push(
          "an invite or access request already exists for this email; skipped"
        );
        continue;
      }

      // Role on a create: the invite path cannot set one (approved_role is
      // never written, so signup lands on 'member').
      if (row.role === "admin") {
        fail(row, {
          code: "ROLE_ESCALATION",
          field: "role",
          message:
            "an import cannot create an admin; invite them and promote in the app",
        });
        result.action = "error";
        continue;
      }
      if (row.role !== null && row.role !== "member") {
        result.warnings.push(
          `role "${row.role}" is ignored on a new invite; invited members sign up as member`
        );
      }
      if (row.groups.length > 0) {
        // GROUPS_ON_INVITE: there is no profile to assign until signup (the
        // profiles INSERT happens in the auth trigger), so assignments drop.
        result.warnings.push(
          "groups on a new invite are ignored; assign groups after they sign up"
        );
      }
      if (row.household_key !== null || row.household_name !== null) {
        result.warnings.push(
          "household on a new invite is ignored; set their household after they sign up"
        );
      }
      result.action = "create_invite";
      accessRequestInserts.push({
        kind: "insert_access_request",
        line: row.line,
        email: norm(row.email!),
        name:
          [row.first_name, row.last_name].filter(Boolean).join(" ") ||
          norm(row.email!),
      });
      continue;
    }

    // ---- has_login=false: family_members paths --------------------------
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

    // Non-empty groups is the authoritative membership set for this person.
    const groupWrites: PlannedWrite[] = [];
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
      case "create_invite":
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
          ...accessRequestInserts,
          ...profileGroupWrites,
        ];

  return { rows: results, summary, writes };
}

/** True when the key came from the file, not the per-row synthetic. */
function isFileHouseholdKey(key: string): boolean {
  return !key.startsWith("__row-");
}
