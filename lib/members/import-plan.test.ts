// Unit tests for the import planner. Pure units: planImport takes
// parsed rows plus a plain-data snapshot to a plan — no network, no
// database, no request context. The round-trip test here is the brief's
// no-op proof: exporting an org and re-importing the file must plan zero
// writes.

import { describe, expect, it } from "vitest";
import {
  memberRowsFromSnapshot,
  parseMembers,
  serializeMembers,
  type MemberRow,
} from "@/lib/members/format";
import { planImport } from "@/lib/members/import-plan";
import type {
  OrgSnapshot,
  SnapshotFamilyMember,
  SnapshotProfile,
} from "@/lib/members/snapshot";

function profile(
  overrides: Partial<SnapshotProfile> & { id: string }
): SnapshotProfile {
  return {
    email: null,
    role: "member",
    relationship: "primary",
    first_name: null,
    last_name: null,
    preferred_name: null,
    phone_mobile: null,
    phone_home: null,
    phone_work: null,
    birth_month: null,
    birth_day: null,
    birth_year: null,
    address_line1: null,
    address_line2: null,
    city: null,
    state: null,
    postal_code: null,
    occupation: null,
    employer: null,
    family_id: null,
    is_unlisted: false,
    email_announcements: true,
    hide_email: false,
    ...overrides,
  };
}

function familyMember(
  overrides: Partial<SnapshotFamilyMember> & { id: string; family_id: string }
): SnapshotFamilyMember {
  return {
    first_name: "Kid",
    last_name: null,
    preferred_name: null,
    birth_month: null,
    birth_day: null,
    birth_year: null,
    relationship: "child",
    is_class_member: true,
    ...overrides,
  };
}

function makeRow(overrides: Partial<MemberRow>): MemberRow {
  return {
    line: 1,
    first_name: "New",
    preferred_name: null,
    last_name: "Person",
    email: null,
    phone_mobile: null,
    phone_home: null,
    phone_work: null,
    birth_month: null,
    birth_day: null,
    birth_year: null,
    relationship: null,
    has_login: false,
    role: null,
    is_class_member: null,
    household_key: null,
    household_name: null,
    household_primary: false,
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
    ...overrides,
  };
}

const emptySnapshot: OrgSnapshot = {
  profiles: [],
  families: [],
  familyMembers: [],
  groups: [],
  profileGroups: [],
  accessRequestEmails: [],
};

/**
 * The full-org fixture the round-trip proof runs against: an admin, a
 * member, a pending member, every-hide-flag and no-hide-flag
 * members, a null last name, a household with two profiles and a
 * family_members child, a member in two groups (leader of one), an unhoused
 * member, and a name containing a comma, a double quote, and a leading `=`.
 */
function makeFixtureSnapshot(): OrgSnapshot {
  return {
    profiles: [
      profile({
        id: "p1",
        email: "al@example.org",
        role: "admin",
        relationship: "primary",
        first_name: "Al",
        last_name: "Alpha",
        preferred_name: "Big Al",
        phone_mobile: "+15551230001",
        phone_home: "555-123-0002",
        phone_work: "555-123-0003",
        birth_month: 4,
        birth_day: 30,
        birth_year: 1950,
        address_line1: "1 Main St",
        address_line2: "Apt 2",
        city: "Springfield",
        state: "TX",
        postal_code: "75001",
        occupation: "Teacher",
        employer: "ISD",
        family_id: "f1",
        is_unlisted: true,
        email_announcements: false,
        hide_email: true,
      }),
      profile({
        id: "p2",
        email: "bea@example.org",
        role: "member",
        relationship: "spouse",
        first_name: "Bea",
        last_name: "Alpha",
        family_id: "f1",
      }),
      profile({
        id: "p3",
        email: "pending@example.org",
        role: "pending",
        first_name: "Penny",
        last_name: "Beta",
        family_id: "f2",
      }),
      profile({
        id: "p4",
        email: "evil@example.org",
        first_name: '=Evil, "Name"',
        last_name: null,
      }),
      // profiles.first_name is nullable and NULL for anyone who signed up
      // without full_name metadata — every invite-bulk signup lands this way
      // until they fill in their profile. Export writes a blank cell for it.
      profile({
        id: "p5",
        email: "nameless@example.org",
        first_name: null,
        last_name: null,
      }),
      // profiles.email is nullable too. Such a row has no match key at all,
      // so the round-trip proof below is what pins that it plans nothing
      // rather than 422-ing the file.
      profile({
        id: "p6",
        email: null,
        first_name: "Nomail",
        last_name: "Gamma",
      }),
    ],
    families: [
      { id: "f1", family_name: "Alpha", anniversary_month: 6, anniversary_day: 15, anniversary_year: 1972 },
      { id: "f2", family_name: "Beta", anniversary_month: null, anniversary_day: null, anniversary_year: null },
    ],
    familyMembers: [
      familyMember({
        id: "m1",
        family_id: "f1",
        first_name: "Kid",
        last_name: "Alpha",
        birth_month: 3,
        birth_day: 3,
        birth_year: 2015,
      }),
    ],
    groups: [
      { id: "g1", name: "Worship" },
      { id: "g2", name: "Hospitality" },
    ],
    profileGroups: [
      { profile_id: "p1", group_id: "g1", is_leader: true },
      { profile_id: "p1", group_id: "g2", is_leader: false },
    ],
    accessRequestEmails: [],
  };
}

describe("planImport round-trip", () => {
  it("proves export → import is a no-op: zero errors, zero writes", () => {
    const snapshot = makeFixtureSnapshot();
    const csv = serializeMembers(memberRowsFromSnapshot(snapshot));
    const parsed = parseMembers(csv);
    expect(parsed.error).toBeUndefined();
    const plan = planImport(parsed.rows, snapshot);
    expect(plan.summary.error).toBe(0);
    expect(plan.summary.create).toBe(0);
    expect(plan.summary.update).toBe(0);
    expect(plan.summary.noChange).toBe(plan.summary.rows);
    // The actual no-op assertion — the one that cannot be faked.
    expect(plan.writes).toEqual([]);
  });
});

describe("planImport error codes", () => {
  it("reports AMBIGUOUS_MATCH when two profiles share the email (email is not unique)", () => {
    const snapshot: OrgSnapshot = {
      ...emptySnapshot,
      profiles: [
        profile({ id: "p1", email: "dup@example.org", first_name: "A" }),
        profile({ id: "p2", email: "dup@example.org", first_name: "B" }),
      ],
    };
    const plan = planImport(
      [makeRow({ email: "dup@example.org", has_login: true })],
      snapshot
    );
    expect(plan.rows[0].errors[0].code).toBe("AMBIGUOUS_MATCH");
    expect(plan.rows[0].action).toBe("error");
  });

  it("reports AMBIGUOUS_HOUSEHOLD when two households share the name", () => {
    const snapshot: OrgSnapshot = {
      ...emptySnapshot,
      families: [
        { id: "f1", family_name: "Same", anniversary_month: null, anniversary_day: null, anniversary_year: null },
        { id: "f2", family_name: "Same", anniversary_month: null, anniversary_day: null, anniversary_year: null },
      ],
    };
    const plan = planImport(
      [makeRow({ household_name: "Same" })],
      snapshot
    );
    expect(plan.rows[0].errors[0].code).toBe("AMBIGUOUS_HOUSEHOLD");
  });

  it("reports UNKNOWN_GROUP for a group name the org does not have", () => {
    const snapshot = makeFixtureSnapshot();
    const plan = planImport(
      [
        makeRow({
          email: "al@example.org",
          has_login: true,
          first_name: "Al",
          groups: ["Nope"],
        }),
      ],
      snapshot
    );
    expect(plan.rows[0].errors[0].code).toBe("UNKNOWN_GROUP");
  });

  it("rejects a role change INTO admin (ROLE_ESCALATION)", () => {
    const plan = planImport(
      [
        makeRow({
          email: "bea@example.org",
          has_login: true,
          first_name: "Bea",
          role: "admin",
        }),
      ],
      makeFixtureSnapshot()
    );
    expect(plan.rows[0].errors[0].code).toBe("ROLE_ESCALATION");
  });

  it("rejects a role change OUT OF admin — no silent demotion", () => {
    const plan = planImport(
      [
        makeRow({
          email: "al@example.org",
          has_login: true,
          first_name: "Al",
          role: "member",
        }),
      ],
      makeFixtureSnapshot()
    );
    expect(plan.rows[0].errors[0].code).toBe("ROLE_ESCALATION");
  });

  it("rejects a brand-new person with a login before role is even considered", () => {
    // Previously ROLE_ESCALATION. v1 cannot create a login at all, so the row
    // fails earlier and for a broader reason — role never enters into it.
    const plan = planImport(
      [
        makeRow({
          email: "new@example.org",
          has_login: true,
          role: "admin",
        }),
      ],
      makeFixtureSnapshot()
    );
    expect(plan.rows[0].errors[0].code).toBe("LOGIN_CREATE_UNSUPPORTED");
  });

  it("allows role=admin when it equals the stored role", () => {
    const plan = planImport(
      [
        makeRow({
          email: "al@example.org",
          has_login: true,
          first_name: "Al",
          last_name: null,
          role: "admin",
        }),
      ],
      makeFixtureSnapshot()
    );
    expect(plan.rows[0].errors).toEqual([]);
    expect(plan.rows[0].action).toBe("no_change");
  });

  it("allows an ordinary role change that touches no admin", () => {
    const plan = planImport(
      [
        makeRow({
          email: "bea@example.org",
          has_login: true,
          first_name: "Bea",
          role: "pending",
        }),
      ],
      makeFixtureSnapshot()
    );
    expect(plan.rows[0].action).toBe("update_profile");
    expect(plan.rows[0].changes?.role).toEqual(["member", "pending"]);
  });

  it("reports HAS_LOGIN_CHANGE when a family member row claims a login", () => {
    const plan = planImport(
      [
        makeRow({
          email: "kid@example.org",
          has_login: true,
          first_name: "Kid",
          last_name: "Alpha",
          birth_month: 3,
          birth_day: 3,
          birth_year: 2015,
          household_name: "Alpha",
        }),
      ],
      makeFixtureSnapshot()
    );
    expect(plan.rows[0].errors[0].code).toBe("HAS_LOGIN_CHANGE");
  });

  it("reports HAS_LOGIN_CHANGE when a login member is downgraded to a family member", () => {
    const plan = planImport(
      [
        makeRow({
          email: "al@example.org",
          has_login: false,
          first_name: "Al",
          last_name: "Alpha",
          household_name: "Alpha",
        }),
      ],
      makeFixtureSnapshot()
    );
    expect(plan.rows[0].errors[0].code).toBe("HAS_LOGIN_CHANGE");
  });

  it("reports MISSING_REQUIRED for a missing first_name on a member without a login", () => {
    const plan = planImport(
      [makeRow({ first_name: null, household_name: "X" })],
      emptySnapshot
    );
    expect(plan.rows[0].errors[0]).toMatchObject({
      code: "MISSING_REQUIRED",
      field: "first_name",
    });
  });

  it("does NOT require first_name on a row matched to an existing profile", () => {
    // profiles.first_name is nullable and genuinely NULL for anyone who
    // signed up without full_name metadata, so export writes a blank cell.
    // Requiring it here would 422 the whole file on the org's own export.
    const snapshot: OrgSnapshot = {
      ...emptySnapshot,
      profiles: [
        profile({ id: "p1", email: "nameless@example.org", first_name: null }),
      ],
    };
    const plan = planImport(
      [
        makeRow({
          has_login: true,
          email: "nameless@example.org",
          first_name: null,
          last_name: null,
        }),
      ],
      snapshot
    );
    expect(plan.rows[0].errors).toEqual([]);
    expect(plan.rows[0].action).toBe("no_change");
    expect(plan.writes).toEqual([]);
  });

  it("reports LOGIN_CREATE_UNSUPPORTED for a new person with a login", () => {
    // v1 cannot create a login: the approved access_requests row an invite
    // needs violates that table's only INSERT policy, so attempting the write
    // would 500 mid-apply. Failing at validation keeps "nothing applies
    // unless everything validates" intact.
    const plan = planImport(
      [makeRow({ has_login: true, email: "brand-new@example.org", first_name: "Iva" })],
      emptySnapshot
    );
    expect(plan.rows[0].errors[0]).toMatchObject({
      code: "LOGIN_CREATE_UNSUPPORTED",
      field: "has_login",
    });
    expect(plan.rows[0].action).toBe("error");
    expect(plan.writes).toEqual([]);
  });

  it("never plans a write against access_requests", () => {
    // The structural half of the rule above: no plan, from any input, may
    // contain the write kind that cannot pass RLS.
    const plan = planImport(
      [
        makeRow({ has_login: true, email: "al@example.org", first_name: "Al" }),
        makeRow({ line: 2, first_name: "Kid", household_name: "Alpha" }),
      ],
      makeFixtureSnapshot()
    );
    expect(JSON.stringify(plan.writes)).not.toContain("access_request");
  });

  it("reports INVALID_EMAIL for a malformed address", () => {
    const plan = planImport(
      [makeRow({ has_login: true, email: "not-an-email" })],
      emptySnapshot
    );
    expect(plan.rows[0].errors[0].code).toBe("INVALID_EMAIL");
  });

  it("reports INVALID_DATE for an impossible anniversary", () => {
    const plan = planImport(
      [makeRow({ household_name: "X", anniversary: "2020-02-30" })],
      emptySnapshot
    );
    expect(plan.rows[0].errors[0].code).toBe("INVALID_DATE");
  });

  it("reports INVALID_BIRTH_PART for an out-of-range month and a non-integer", () => {
    const plan = planImport(
      [
        makeRow({ household_name: "X", birth_month: 13 }),
        makeRow({ line: 2, household_name: "X", first_name: "Other", birth_day: Number.NaN }),
      ],
      emptySnapshot
    );
    expect(plan.rows[0].errors[0]).toMatchObject({
      code: "INVALID_BIRTH_PART",
      field: "birth_month",
    });
    expect(plan.rows[1].errors[0]).toMatchObject({
      code: "INVALID_BIRTH_PART",
      field: "birth_day",
    });
  });

  it("reports INVALID_RELATIONSHIP for a value outside the enum", () => {
    const plan = planImport(
      [makeRow({ household_name: "X", relationship: "cousin" })],
      emptySnapshot
    );
    expect(plan.rows[0].errors[0].code).toBe("INVALID_RELATIONSHIP");
  });

  it("reports INVALID_ROLE for a value outside the enum", () => {
    const plan = planImport(
      [makeRow({ has_login: true, email: "x@example.org", role: "superadmin" })],
      emptySnapshot
    );
    expect(plan.rows[0].errors[0].code).toBe("INVALID_ROLE");
  });

  it("reports DUPLICATE_IN_FILE on the second row with the same email", () => {
    const snapshot: OrgSnapshot = {
      ...emptySnapshot,
      profiles: [profile({ id: "p1", email: "dup@example.org", first_name: "D" })],
    };
    const plan = planImport(
      [
        makeRow({ has_login: true, email: "dup@example.org", first_name: "D" }),
        makeRow({
          line: 2,
          has_login: true,
          email: "DUP@example.org",
          first_name: "D",
        }),
      ],
      snapshot
    );
    expect(plan.rows[0].errors).toEqual([]);
    expect(plan.rows[1].errors[0].code).toBe("DUPLICATE_IN_FILE");
  });

  it("reports DUPLICATE_IN_FILE on the second family member with the same household, name, and birth", () => {
    const plan = planImport(
      [
        makeRow({ household_key: "hh-1", household_name: "X" }),
        makeRow({ line: 2, household_key: "hh-1", household_name: "X" }),
      ],
      emptySnapshot
    );
    expect(plan.rows[1].errors[0].code).toBe("DUPLICATE_IN_FILE");
  });

  it("reports MISSING_HOUSEHOLD_NAME for a family member with no household to join", () => {
    const plan = planImport([makeRow({})], emptySnapshot);
    expect(plan.rows[0].errors[0].code).toBe("MISSING_HOUSEHOLD_NAME");
  });
});

describe("planImport semantics", () => {
  it("treats a blank cell as 'not provided', never as a clear", () => {
    // p1 has a stored phone_mobile; the row's phone cell is blank.
    const plan = planImport(
      [
        makeRow({
          email: "al@example.org",
          has_login: true,
          first_name: "Al",
          last_name: null,
          phone_mobile: null,
        }),
      ],
      makeFixtureSnapshot()
    );
    expect(plan.rows[0].action).toBe("no_change");
    expect(plan.writes).toEqual([]);
  });

  it("plans exactly one field update for one changed phone number", () => {
    const plan = planImport(
      [
        makeRow({
          email: "al@example.org",
          has_login: true,
          first_name: "Al",
          last_name: null,
          phone_mobile: "+15559990000",
        }),
      ],
      makeFixtureSnapshot()
    );
    expect(plan.rows[0].action).toBe("update_profile");
    expect(plan.rows[0].changes).toEqual({
      phone_mobile: ["+15551230001", "+15559990000"],
    });
    expect(plan.writes).toEqual([
      {
        kind: "update_profile",
        line: 1,
        id: "p1",
        values: { phone_mobile: "+15559990000" },
      },
    ]);
  });

  it("never plans a write that carries org_id", () => {
    // Exercise every write kind: new household + family member, profile
    // update, new invite, and group changes.
    const plan = planImport(
      [
        makeRow({
          email: "bea@example.org",
          has_login: true,
          first_name: "Bea",
          phone_mobile: "+15550001111",
          groups: ["Worship"],
          leads: ["Worship"],
        }),
        makeRow({
          line: 2,
          first_name: "Newkid",
          household_key: "hh-9",
          household_name: "Newfam",
          relationship: "child",
          is_class_member: true,
        }),
      ],
      makeFixtureSnapshot()
    );
    expect(plan.summary.error).toBe(0);
    expect(plan.writes.length).toBeGreaterThan(0);
    // The tenancy assertion CI's SQL lint cannot make: no payload the PLANNER
    // produces names a tenant, because everything it sees came out of an
    // uploaded file. The org is stamped downstream by applyWrites() from the
    // caller's validated orgId — see apply.test.ts.
    expect(JSON.stringify(plan.writes)).not.toContain("org_id");
  });

  it("reports a blank-email profile row as an unmatchable no_change, not an error", () => {
    // profiles.email is nullable, so export emits has_login=true with a blank
    // email cell. Email is the only match key a login holder has, so the row
    // can be neither matched nor created — but erroring would 422 the whole
    // file and make the org's own export unimportable.
    const snapshot: OrgSnapshot = {
      ...emptySnapshot,
      profiles: [profile({ id: "p1", email: null, first_name: "Nomail" })],
    };
    const plan = planImport(
      [makeRow({ has_login: true, email: null, first_name: "Nomail" })],
      snapshot
    );
    expect(plan.rows[0].errors).toEqual([]);
    expect(plan.rows[0].action).toBe("no_change");
    expect(
      plan.rows[0].warnings.some((w) => w.includes("no email on this row"))
    ).toBe(true);
    expect(plan.writes).toEqual([]);
  });

  it("applies nothing when any row has an error", () => {
    const plan = planImport(
      [
        makeRow({
          email: "al@example.org",
          has_login: true,
          first_name: "Al",
          phone_mobile: "+15559990000",
        }),
        makeRow({ line: 2, has_login: true, email: "not-an-email" }),
      ],
      makeFixtureSnapshot()
    );
    expect(plan.summary.error).toBe(1);
    expect(plan.summary.update).toBe(1);
    // One bad row means the whole file applies nothing.
    expect(plan.writes).toEqual([]);
  });

  it("skips re-inviting an email that already has an access request", () => {
    const snapshot = {
      ...makeFixtureSnapshot(),
      accessRequestEmails: ["invited@example.org"],
    };
    const plan = planImport(
      [makeRow({ has_login: true, email: "Invited@example.org", first_name: "Iva" })],
      snapshot
    );
    expect(plan.rows[0].action).toBe("no_change");
    expect(plan.writes).toEqual([]);
  });

  it("puts rows sharing a household_name into ONE new household, not one per row", () => {
    // Export always emits household_key, so this is about hand-authored
    // files — the primary import use case. Keying on the row number turned a
    // family of four typed a row at a time into four one-person households,
    // and that state is unrecoverable: it makes every later import of the
    // same file a permanent AMBIGUOUS_HOUSEHOLD, with no in-app merge.
    const rows = [
      makeRow({ first_name: "Zeb", last_name: "Zeta", household_name: "Zeta Family" }),
      makeRow({
        line: 2,
        first_name: "Zoe",
        last_name: "Zeta",
        household_name: "Zeta Family",
      }),
    ];
    const plan = planImport(rows, emptySnapshot);
    expect(plan.summary.error).toBe(0);
    expect(plan.summary.householdsCreate).toBe(1);
    const unitInserts = plan.writes.filter(
      (w) => w.kind === "insert_family_unit"
    );
    expect(unitInserts).toHaveLength(1);
    // Both people land in it.
    const memberInserts = plan.writes.filter(
      (w) => w.kind === "insert_family_member"
    );
    expect(memberInserts).toHaveLength(2);
    const key = unitInserts[0].kind === "insert_family_unit" && unitInserts[0].householdKey;
    for (const write of memberInserts) {
      expect(write.kind === "insert_family_member" && write.householdKey).toBe(key);
    }
  });

  it("re-importing the same hand-authored file is a no-op (the property, not the patch)", () => {
    // The second run must see the household it created and join it, not make
    // another. This is what distinguishes a real fix from one that only makes
    // the first run look right.
    const rows = () => [
      makeRow({ first_name: "Zeb", last_name: "Zeta", household_name: "Zeta Family" }),
      makeRow({
        line: 2,
        first_name: "Zoe",
        last_name: "Zeta",
        household_name: "Zeta Family",
      }),
    ];
    const afterFirstRun: OrgSnapshot = {
      ...emptySnapshot,
      families: [{ id: "f9", family_name: "Zeta Family", anniversary_month: null, anniversary_day: null, anniversary_year: null }],
      familyMembers: [
        familyMember({
          id: "m9",
          family_id: "f9",
          first_name: "Zeb",
          last_name: "Zeta",
          relationship: "other",
        }),
        familyMember({
          id: "m10",
          family_id: "f9",
          first_name: "Zoe",
          last_name: "Zeta",
          relationship: "other",
        }),
      ],
    };
    const plan = planImport(rows(), afterFirstRun);
    expect(plan.summary.error).toBe(0);
    expect(plan.writes).toEqual([]);
  });

  it("does not create two households with the same name from two distinct file keys", () => {
    // family_units.family_name has no unique constraint, so nothing
    // downstream would stop the duplicate — and a duplicate name is exactly
    // what makes name-based resolution a permanent AMBIGUOUS_HOUSEHOLD.
    const plan = planImport(
      [
        makeRow({
          first_name: "Zeb",
          household_key: "a",
          household_name: "Zeta Family",
        }),
        makeRow({
          line: 2,
          first_name: "Zoe",
          household_key: "b",
          household_name: "Zeta Family",
        }),
      ],
      emptySnapshot
    );
    expect(plan.summary.householdsCreate).toBe(1);
    expect(
      plan.writes.filter((w) => w.kind === "insert_family_member")
    ).toHaveLength(2);
  });

  it("keeps keyless rows with no household_name in separate synthetic groups", () => {
    // The __row- fallback still applies when there is nothing to group on —
    // two unnamed rows are two different people, not one household.
    const plan = planImport(
      [
        makeRow({ first_name: "A", household_name: null }),
        makeRow({ line: 2, first_name: "B", household_name: null }),
      ],
      emptySnapshot
    );
    // Both fail for want of a household, independently.
    expect(plan.rows.map((r) => r.errors[0]?.code)).toEqual([
      "MISSING_HOUSEHOLD_NAME",
      "MISSING_HOUSEHOLD_NAME",
    ]);
  });

  it("warns rather than silently ignoring a blank groups cell for a member who has groups", () => {
    // Blank means "not provided" (the scalar rule), so the membership stays.
    // A silent no-op on an explicit edit is the worst available behavior.
    const plan = planImport(
      [
        makeRow({
          email: "al@example.org",
          has_login: true,
          first_name: "Al",
          last_name: "Alpha",
          groups: [],
        }),
      ],
      makeFixtureSnapshot()
    );
    expect(plan.rows[0].action).toBe("no_change");
    expect(plan.writes).toEqual([]);
    expect(
      plan.rows[0].warnings.some((w) => w.includes("groups is blank"))
    ).toBe(true);
  });

  it("warns when a row leaves the email setting out, and never turns it off", () => {
    const plan = planImport(
      [
        makeRow({
          email: "al@example.org",
          has_login: true,
          first_name: "Al",
          hidden_fields: ["phone_mobile"],
        }),
      ],
      makeFixtureSnapshot()
    );
    expect(plan.rows[0].warnings.some((w) => w.includes("email stays hidden"))).toBe(true);
    const writes = plan.writes.filter((w) => w.kind === "update_profile");
    for (const write of writes) expect(write.values).not.toHaveProperty("hide_email");
  });

  it("turns the email setting on when a row asks", () => {
    const plan = planImport(
      [makeRow({ email: "bea@example.org", has_login: true, first_name: "Bea", last_name: "Alpha", hidden_fields: ["email"] })],
      makeFixtureSnapshot()
    );
    expect(plan.rows[0].changes?.hide_email).toEqual([false, true]);
    expect(plan.writes).toContainEqual(
      expect.objectContaining({ kind: "update_profile", id: "p2", values: { hide_email: true } })
    );
  });

  it("doesn't store a value the file marks hidden, and says so", () => {
    const plan = planImport(
      [
        makeRow({
          email: "bea@example.org",
          has_login: true,
          first_name: "Bea",
          last_name: "Alpha",
          phone_mobile: "+15559990000",
          occupation: "Secret",
          employer: "Also secret",
          city: "Visible City",
          hidden_fields: ["phone_mobile", "occupation"],
        }),
      ],
      makeFixtureSnapshot()
    );
    expect(plan.writes).toEqual([
      expect.objectContaining({ kind: "update_profile", id: "p2", values: { city: "Visible City" } }),
    ]);
    expect(plan.rows[0].warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("hidden_fields marks phone_mobile hidden"),
        expect.stringContaining("hidden_fields marks occupation hidden"),
      ])
    );
    expect(JSON.stringify(plan)).not.toContain("Secret");
  });

  it("leaves a hidden birthday off a new family member, and doesn't add one who exists twice", () => {
    const created = planImport(
      [
        makeRow({
          first_name: "Newkid",
          household_name: "Alpha",
          birth_month: 3,
          birth_day: 4,
          birth_year: 2010,
          hidden_fields: ["birthday"],
        }),
      ],
      makeFixtureSnapshot()
    );
    expect(created.writes).toEqual([
      expect.objectContaining({
        kind: "insert_family_member",
        values: expect.not.objectContaining({ birth_month: expect.anything() }),
      }),
    ]);

    const snapshot = makeFixtureSnapshot();
    const [existing] = snapshot.familyMembers;
    const matched = planImport(
      [
        makeRow({
          first_name: existing.first_name,
          last_name: existing.last_name,
          household_name: "Alpha",
          relationship: existing.relationship,
          birth_month: existing.birth_month,
          birth_day: existing.birth_day,
          birth_year: existing.birth_year,
          hidden_fields: ["birthday"],
        }),
      ],
      snapshot
    );
    expect(matched.writes).toEqual([]);
    expect(matched.rows[0].matchedBy).toBe("household_name_birth");
  });

  describe("a birthday the file marks hidden still says who the row is", () => {
    const sam = {
      first_name: "Sam",
      last_name: "Smith",
      birth_month: 3,
      birth_day: 4,
      birth_year: 2010,
    };
    const samRow = (overrides: Partial<MemberRow> = {}) =>
      makeRow({ ...sam, household_name: "Smith Family", hidden_fields: ["birthday"], ...overrides });
    const withFamilies = (rest: Partial<OrgSnapshot>): OrgSnapshot => ({
      ...emptySnapshot,
      families: [
        { id: "smith", family_name: "Smith Family", anniversary_month: null, anniversary_day: null, anniversary_year: null },
        { id: "jones", family_name: "Jones Family", anniversary_month: null, anniversary_day: null, anniversary_year: null },
      ],
      ...rest,
    });

    it.each(["birthday", "birth_year"] as const)(
      "refuses a person in another household, with %s hidden",
      (token) => {
        const plan = planImport(
          [samRow({ hidden_fields: [token] })],
          withFamilies({ familyMembers: [familyMember({ id: "fm", family_id: "jones", ...sam })] })
        );
        expect(plan.rows[0].errors.map((e) => e.code)).toEqual(["HOUSEHOLD_MOVE"]);
        expect(plan.writes).toEqual([]);
      }
    );

    it("refuses a person who has a login in this household", () => {
      const plan = planImport(
        [samRow()],
        withFamilies({ profiles: [profile({ id: "p", family_id: "smith", ...sam })] })
      );
      expect(plan.rows[0].errors.map((e) => e.code)).toEqual(["HAS_LOGIN_CHANGE"]);
      expect(plan.writes).toEqual([]);
    });

    it("refuses a person whose stored birthday is already gone", () => {
      const { first_name, last_name } = sam;
      const elsewhere = planImport(
        [samRow()],
        withFamilies({ familyMembers: [familyMember({ id: "fm", family_id: "jones", first_name, last_name })] })
      );
      expect(elsewhere.rows[0].errors.map((e) => e.code)).toEqual(["HOUSEHOLD_MOVE"]);

      const withLogin = planImport(
        [samRow()],
        withFamilies({ profiles: [profile({ id: "p", family_id: "smith", first_name, last_name })] })
      );
      expect(withLogin.rows[0].errors.map((e) => e.code)).toEqual(["HAS_LOGIN_CHANGE"]);
    });

    it("refuses a login row for a family member already in this household", () => {
      const plan = planImport(
        [samRow({ has_login: true, email: "sam@example.org" })],
        withFamilies({ familyMembers: [familyMember({ id: "fm", family_id: "smith", ...sam })] })
      );
      expect(plan.rows[0].errors.map((e) => e.code)).toEqual(["HAS_LOGIN_CHANGE"]);
    });

    it("keeps two people with one name apart in a file, and stores neither birthday", () => {
      const plan = planImport(
        [samRow({ line: 1 }), samRow({ line: 2, birth_year: 1980 })],
        withFamilies({})
      );
      expect(plan.rows.map((r) => r.action)).toEqual(["create_family_member", "create_family_member"]);
      const inserts = plan.writes.filter((w) => w.kind === "insert_family_member");
      expect(inserts).toHaveLength(2);
      for (const insert of inserts) {
        expect(insert.values).not.toHaveProperty("birth_month");
        expect(insert.values).not.toHaveProperty("birth_year");
      }
    });

    it("still refuses the same person twice in a file", () => {
      const plan = planImport([samRow({ line: 1 }), samRow({ line: 2 })], withFamilies({}));
      expect(plan.rows[1].errors.map((e) => e.code)).toEqual(["DUPLICATE_IN_FILE"]);
    });
  });

  describe("birthday parts", () => {
    it("refuses a new person's month with no day", () => {
      const plan = planImport(
        [makeRow({ first_name: "Kid", household_name: "Alpha", birth_month: 3 })],
        makeFixtureSnapshot()
      );
      expect(plan.rows[0].errors).toEqual([
        expect.objectContaining({ code: "INVALID_BIRTH_PART", field: "birth_day" }),
      ]);
    });

    it("accepts a year alone for someone whose month and day are stored", () => {
      const plan = planImport(
        [makeRow({ email: "al@example.org", has_login: true, first_name: "Al", birth_year: 1951 })],
        makeFixtureSnapshot()
      );
      expect(plan.rows[0].errors).toEqual([]);
    });

    it("keeps an org's own export importable when a stored birthday is incomplete", () => {
      const snapshot = makeFixtureSnapshot();
      snapshot.profiles[1] = { ...snapshot.profiles[1], birth_month: 5, birth_day: null };
      const plan = planImport(memberRowsFromSnapshot(snapshot), snapshot);
      expect(plan.summary.error).toBe(0);
    });
  });

  describe("household anniversary", () => {
    const couple = (over: { al?: Partial<MemberRow>; bea?: Partial<MemberRow> }) => [
      makeRow({ email: "al@example.org", has_login: true, first_name: "Al", household_primary: true, ...over.al }),
      makeRow({ email: "bea@example.org", has_login: true, first_name: "Bea", ...over.bea }),
    ];
    const snapshotWith = (
      anniversary_month: number | null,
      anniversary_day: number | null,
      anniversary_year: number | null
    ) => {
      const snapshot = makeFixtureSnapshot();
      snapshot.families[0] = { ...snapshot.families[0], anniversary_month, anniversary_day, anniversary_year };
      return snapshot;
    };

    it("writes the household, from the household_primary row, naming the disagreement", () => {
      const plan = planImport(
        couple({ al: { anniversary: "2009-10-03" }, bea: { anniversary: "2010-01-01" } }),
        snapshotWith(null, null, null)
      );
      expect(plan.writes).toContainEqual({
        kind: "update_family_unit",
        line: 1,
        id: "f1",
        values: { anniversary_month: 10, anniversary_day: 3, anniversary_year: 2009 },
      });
      expect(plan.rows[0].action).toBe("update_profile");
      expect(plan.rows[0].changes?.anniversary).toEqual([null, "2009-10-03"]);
      expect(plan.rows[0].warnings.some((w) => w.includes("disagree on: anniversary"))).toBe(true);
      expect(JSON.stringify(plan.rows[0].warnings)).not.toContain("2010");
    });

    it("stores a yearless date, and treats a matching month and day as no change", () => {
      expect(
        planImport(couple({ al: { anniversary: "10-03" } }), snapshotWith(null, null, null)).writes
      ).toContainEqual(
        expect.objectContaining({
          kind: "update_family_unit",
          values: { anniversary_month: 10, anniversary_day: 3, anniversary_year: null },
        })
      );
      expect(
        planImport(couple({ al: { anniversary: "10-03" } }), snapshotWith(10, 3, 2009)).writes.filter(
          (w) => w.kind === "update_family_unit"
        )
      ).toEqual([]);
    });

    it("writes nothing when either spouse marks it hidden, even with the other's cell filled", () => {
      const plan = planImport(
        couple({ al: { anniversary: "2009-10-03" }, bea: { anniversary: "2009-10-03", hidden_fields: ["anniversary"] } }),
        snapshotWith(null, null, null)
      );
      expect(plan.writes.filter((w) => w.kind === "update_family_unit")).toEqual([]);
      expect(plan.rows[0].warnings.some((w) => w.includes("couple's anniversary hidden"))).toBe(true);
      expect(plan.rows[1].warnings.some((w) => w.includes("hidden_fields marks anniversary hidden"))).toBe(true);
    });

    it("finds the couple through their match when the rows name no household", () => {
      const plan = planImport(
        couple({ al: { household_primary: false, anniversary: "2009-10-03" }, bea: { hidden_fields: ["anniversary"] } }),
        snapshotWith(null, null, null)
      );
      expect(plan.writes.filter((w) => w.kind === "update_family_unit")).toEqual([]);
    });

    it("sets it on a household this run creates", () => {
      const plan = planImport(
        [makeRow({ first_name: "Newkid", household_name: "Newfam", relationship: "primary", anniversary: "2009-10-03" })],
        makeFixtureSnapshot()
      );
      expect(plan.writes[0]).toMatchObject({
        kind: "insert_family_unit",
        values: { family_name: "Newfam", anniversary_month: 10, anniversary_day: 3, anniversary_year: 2009 },
      });
    });

    it("ignores it on a child's row, and on a row with no household", () => {
      const child = planImport(
        [makeRow({ email: "al@example.org", has_login: true, first_name: "Al", relationship: "child", anniversary: "2009-10-03" })],
        snapshotWith(null, null, null)
      );
      expect(child.writes.filter((w) => w.kind === "update_family_unit")).toEqual([]);
      expect(child.rows[0].warnings.some((w) => w.includes("belongs to the couple"))).toBe(true);

      const unhoused = planImport(
        [makeRow({ email: "evil@example.org", has_login: true, anniversary: "2009-10-03" })],
        makeFixtureSnapshot()
      );
      expect(unhoused.rows[0].warnings.some((w) => w.includes("this row has none"))).toBe(true);
    });

    it("round-trips a yearless date as no change", () => {
      const snapshot = snapshotWith(10, 3, null);
      const plan = planImport(parseMembers(serializeMembers(memberRowsFromSnapshot(snapshot))).rows, snapshot);
      expect(plan.writes.filter((w) => w.kind === "update_family_unit")).toEqual([]);
      expect(plan.summary.update).toBe(0);
    });
  });

  it("creates a new household then its family member, linked by household key", () => {
    const plan = planImport(
      [
        makeRow({
          first_name: "Newkid",
          household_key: "hh-9",
          household_name: "Newfam",
          relationship: "child",
          is_class_member: false,
          birth_month: 5,
          birth_day: 6,
          birth_year: 2018,
        }),
      ],
      makeFixtureSnapshot()
    );
    expect(plan.summary.householdsCreate).toBe(1);
    expect(plan.writes).toEqual([
      {
        kind: "insert_family_unit",
        line: 1,
        // Namespaced: groupKey() prefixes the file's household_key so it
        // cannot collide with a __name-/__row- synthetic.
        householdKey: "__key-hh-9",
        values: { family_name: "Newfam" },
      },
      {
        kind: "insert_family_member",
        line: 1,
        familyId: null,
        householdKey: "__key-hh-9",
        values: {
          first_name: "Newkid",
          last_name: "Person",
          relationship: "child",
          is_class_member: false,
          birth_month: 5,
          birth_day: 6,
          birth_year: 2018,
        },
      },
    ]);
  });

  it("joins an existing household resolved through a matched member in the same key group", () => {
    const plan = planImport(
      [
        makeRow({
          email: "al@example.org",
          has_login: true,
          first_name: "Al",
          household_key: "hh-1",
        }),
        makeRow({
          line: 2,
          first_name: "Sibling",
          last_name: "Alpha",
          household_key: "hh-1",
          relationship: "child",
        }),
      ],
      makeFixtureSnapshot()
    );
    expect(plan.summary.error).toBe(0);
    expect(plan.summary.householdsCreate).toBe(0);
    const insert = plan.writes.find((w) => w.kind === "insert_family_member");
    expect(insert).toMatchObject({ familyId: "f1", householdKey: null });
  });

  it("diffs group membership as the authoritative set: insert, delete, and leader flip", () => {
    const plan = planImport(
      [
        makeRow({
          email: "al@example.org",
          has_login: true,
          first_name: "Al",
          last_name: null,
          // Stored: leader of Worship, member of Hospitality. Row: member of
          // Worship (leader flip), leader of a group they are not yet in is
          // covered by Bea below — here Hospitality is dropped.
          groups: ["Worship"],
          leads: [],
        }),
        makeRow({
          line: 2,
          email: "bea@example.org",
          has_login: true,
          first_name: "Bea",
          last_name: null,
          groups: ["Hospitality"],
          leads: ["Hospitality"],
        }),
      ],
      makeFixtureSnapshot()
    );
    expect(plan.summary.error).toBe(0);
    expect(plan.writes).toEqual([
      {
        kind: "update_profile_group",
        line: 1,
        profileId: "p1",
        groupId: "g1",
        isLeader: false,
      },
      {
        kind: "delete_profile_group",
        line: 1,
        profileId: "p1",
        groupId: "g2",
      },
      {
        kind: "insert_profile_group",
        line: 2,
        profileId: "p2",
        groupId: "g2",
        isLeader: true,
      },
    ]);
    expect(plan.summary.groupAssignments).toBe(1);
  });

  it("updates a matched family member's changed fields only", () => {
    const plan = planImport(
      [
        makeRow({
          first_name: "Kid",
          last_name: "Alpha",
          birth_month: 3,
          birth_day: 3,
          birth_year: 2015,
          household_name: "Alpha",
          relationship: "child",
          is_class_member: false,
          preferred_name: "Kiddo",
        }),
      ],
      makeFixtureSnapshot()
    );
    expect(plan.rows[0].action).toBe("update_family_member");
    expect(plan.rows[0].matchedBy).toBe("household_name_birth");
    expect(plan.writes).toEqual([
      {
        kind: "update_family_member",
        line: 1,
        id: "m1",
        values: { preferred_name: "Kiddo", is_class_member: false },
      },
    ]);
  });
});

describe("planImport — household identity hazards", () => {
  it("does not merge a file household_key that looks like a synthetic key", () => {
    // groupKey() derives `__name-<household>` and `__row-<line>` for rows
    // that supply no key. If a file's own household_key cell contains one of
    // those strings verbatim, an unnamespaced key would put two unrelated
    // households in the same group — and the module's own comment calls that
    // state unrecoverable, because there is no in-app household merge.
    const plan = planImport(
      [
        makeRow({
          line: 1,
          has_login: false,
          first_name: "Ann",
          last_name: "One",
          household_key: "__name-shared",
          household_name: "First House",
          household_primary: true,
          relationship: "primary",
        }),
        makeRow({
          line: 2,
          has_login: false,
          first_name: "Bob",
          last_name: "Two",
          household_key: null,
          household_name: "Shared",
          household_primary: true,
          relationship: "primary",
        }),
      ],
      emptySnapshot
    );

    expect(plan.rows.every((row) => row.errors.length === 0)).toBe(true);
    // Two distinct households, not one merged household.
    expect(plan.summary.householdsCreate).toBe(2);
    const keys = plan.writes
      .filter((write) => write.kind === "insert_family_unit")
      .map((write) => write.kind === "insert_family_unit" && write.householdKey);
    expect(new Set(keys).size).toBe(2);
  });

  it("rejects a row that would move an existing person to another household", () => {
    // Matching only ever looks inside the household the row resolved to, so
    // without this check the row plans a fresh insert and the person's
    // original family_members record stays put — one human, two households.
    const snapshot: OrgSnapshot = {
      ...emptySnapshot,
      families: [
        { id: "f1", family_name: "Origin", anniversary_month: null, anniversary_day: null, anniversary_year: null },
        { id: "f2", family_name: "Destination", anniversary_month: null, anniversary_day: null, anniversary_year: null },
      ],
      familyMembers: [
        familyMember({
          id: "m1",
          family_id: "f1",
          first_name: "Mover",
          last_name: "Person",
          birth_month: 3,
          birth_day: 4,
          birth_year: 2010,
        }),
      ],
    };

    const plan = planImport(
      [
        makeRow({
          line: 1,
          has_login: false,
          first_name: "Mover",
          last_name: "Person",
          birth_month: 3,
          birth_day: 4,
          birth_year: 2010,
          household_name: "Destination",
          relationship: "child",
        }),
      ],
      snapshot
    );

    expect(plan.rows[0].action).toBe("error");
    expect(plan.rows[0].errors[0].code).toBe("HOUSEHOLD_MOVE");
    // The invariant that matters: a rejected row emits no writes at all.
    expect(plan.writes).toEqual([]);
  });

  it("still updates in place when the person stays in their household", () => {
    // The guard must not fire on the ordinary update path.
    const snapshot: OrgSnapshot = {
      ...emptySnapshot,
      families: [{ id: "f1", family_name: "Origin", anniversary_month: null, anniversary_day: null, anniversary_year: null }],
      familyMembers: [
        familyMember({
          id: "m1",
          family_id: "f1",
          first_name: "Stayer",
          last_name: "Person",
          birth_month: 3,
          birth_day: 4,
          birth_year: 2010,
          is_class_member: true,
        }),
      ],
    };

    const plan = planImport(
      [
        makeRow({
          line: 1,
          has_login: false,
          first_name: "Stayer",
          last_name: "Person",
          birth_month: 3,
          birth_day: 4,
          birth_year: 2010,
          household_name: "Origin",
          relationship: "child",
          is_class_member: false,
        }),
      ],
      snapshot
    );

    expect(plan.rows[0].action).toBe("update_family_member");
  });
});
