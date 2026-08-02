// Unit tests for the import planner (CWA-40). Pure units: planImport takes
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
    anniversary: null,
    occupation: null,
    employer: null,
    family_id: null,
    is_unlisted: false,
    email_announcements: true,
    hide_email: false,
    hide_phone_mobile: false,
    hide_phone_home: false,
    hide_phone_work: false,
    hide_address: false,
    hide_birthday: false,
    hide_birth_year: false,
    hide_anniversary: false,
    hide_occupation: false,
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
 * content_editor, a pending member, every-hide-flag and no-hide-flag
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
        anniversary: "1972-06-15",
        occupation: "Teacher",
        employer: "ISD",
        family_id: "f1",
        is_unlisted: true,
        email_announcements: false,
        hide_email: true,
        hide_phone_mobile: true,
        hide_phone_home: true,
        hide_phone_work: true,
        hide_address: true,
        hide_birthday: true,
        hide_birth_year: true,
        hide_anniversary: true,
        hide_occupation: true,
      }),
      profile({
        id: "p2",
        email: "bea@example.org",
        role: "content_editor",
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
    ],
    families: [
      { id: "f1", family_name: "Alpha" },
      { id: "f2", family_name: "Beta" },
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
        { id: "f1", family_name: "Same" },
        { id: "f2", family_name: "Same" },
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

  it("rejects role=admin on a brand-new invite row", () => {
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
    expect(plan.rows[0].errors[0].code).toBe("ROLE_ESCALATION");
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
          role: "member",
        }),
      ],
      makeFixtureSnapshot()
    );
    expect(plan.rows[0].action).toBe("update_profile");
    expect(plan.rows[0].changes?.role).toEqual(["content_editor", "member"]);
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

  it("reports MISSING_REQUIRED for a missing first_name", () => {
    const plan = planImport(
      [makeRow({ first_name: null, household_name: "X" })],
      emptySnapshot
    );
    expect(plan.rows[0].errors[0]).toMatchObject({
      code: "MISSING_REQUIRED",
      field: "first_name",
    });
  });

  it("reports MISSING_REQUIRED for has_login=true without an email", () => {
    const plan = planImport(
      [makeRow({ has_login: true, email: null })],
      emptySnapshot
    );
    expect(plan.rows[0].errors[0]).toMatchObject({
      code: "MISSING_REQUIRED",
      field: "email",
    });
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
    const plan = planImport(
      [
        makeRow({ has_login: true, email: "dup@example.org" }),
        makeRow({ line: 2, has_login: true, email: "DUP@example.org" }),
      ],
      emptySnapshot
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
        makeRow({
          line: 3,
          has_login: true,
          email: "invitee@example.org",
          first_name: "Iva",
        }),
      ],
      makeFixtureSnapshot()
    );
    expect(plan.summary.error).toBe(0);
    expect(plan.writes.length).toBeGreaterThan(0);
    // The tenancy assertion CI's SQL lint cannot make: no payload names a
    // tenant — inserts rely on the org_id column DEFAULT.
    expect(JSON.stringify(plan.writes)).not.toContain("org_id");
  });

  it("drops group assignments on an invite row with a warning", () => {
    const plan = planImport(
      [
        makeRow({
          has_login: true,
          email: "invitee@example.org",
          first_name: "Iva",
          groups: ["Worship"],
        }),
      ],
      makeFixtureSnapshot()
    );
    expect(plan.rows[0].action).toBe("create_invite");
    expect(
      plan.rows[0].warnings.some((w) => w.includes("groups on a new invite"))
    ).toBe(true);
    expect(plan.writes).toEqual([
      {
        kind: "insert_access_request",
        line: 1,
        email: "invitee@example.org",
        name: "Iva Person",
      },
    ]);
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
        householdKey: "hh-9",
        values: { family_name: "Newfam" },
      },
      {
        kind: "insert_family_member",
        line: 1,
        familyId: null,
        householdKey: "hh-9",
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
