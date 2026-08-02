// Unit tests for the v1 member CSV wire contract (CWA-40). Pure units:
// serializeMembers/parseMembers/memberRowsFromSnapshot take plain data to
// plain data — no network, no database, no request context.

import { describe, expect, it } from "vitest";
import {
  HIDDEN_FIELD_TOKENS,
  MEMBER_CSV_COLUMNS,
  memberRowsFromSnapshot,
  parseMembers,
  serializeMembers,
  type MemberRow,
} from "@/lib/members/format";
import type { OrgSnapshot } from "@/lib/members/snapshot";

function makeRow(overrides: Partial<MemberRow>): MemberRow {
  return {
    line: 1,
    first_name: "Ada",
    preferred_name: null,
    last_name: "Lovelace",
    email: "ada@example.org",
    phone_mobile: null,
    phone_home: null,
    phone_work: null,
    birth_month: null,
    birth_day: null,
    birth_year: null,
    relationship: "primary",
    has_login: true,
    role: "member",
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
    is_unlisted: false,
    email_announcements: true,
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

describe("serializeMembers / parseMembers round-trip", () => {
  it("round-trips rows containing every CSV hazard", () => {
    const rows: MemberRow[] = [
      makeRow({
        line: 1,
        first_name: "=Evil, Formula",
        last_name: 'Say "Hi"',
        email: "evil@example.org",
        phone_mobile: "+15551234567",
        birth_month: 4,
        birth_day: 30,
        birth_year: 1950,
        anniversary: "1972-06-15",
        hidden_fields: ["email", "address"],
        groups: ["Hospitality", "Worship"],
        leads: ["Worship"],
      }),
      makeRow({
        line: 2,
        first_name: "Kid",
        last_name: null,
        email: null,
        has_login: false,
        role: null,
        relationship: "child",
        is_class_member: true,
        is_unlisted: null,
        email_announcements: null,
        household_key: "hh-1",
        household_name: "Lovelace",
        household_primary: false,
      }),
    ];
    const parsed = parseMembers(serializeMembers(rows));
    expect(parsed.error).toBeUndefined();
    expect(parsed.rows).toEqual(rows);
  });

  it("serializes hidden_fields in canonical order regardless of input order", () => {
    const shuffled = makeRow({
      hidden_fields: [
        "occupation",
        "email",
        "birthday",
        "phone_mobile",
      ] as MemberRow["hidden_fields"],
    });
    const text = serializeMembers([shuffled]);
    // Canonical order per HIDDEN_FIELD_TOKENS, not input order.
    expect(text).toContain("email|phone_mobile|birthday|occupation");
    const reparsed = parseMembers(text);
    expect(reparsed.rows[0].hidden_fields).toEqual([
      "email",
      "phone_mobile",
      "birthday",
      "occupation",
    ]);
  });

  it("emits the full ordered header", () => {
    const text = serializeMembers([makeRow({})]);
    expect(text.split("\r\n")[0]).toBe(MEMBER_CSV_COLUMNS.join(","));
  });
});

describe("parseMembers file-level errors", () => {
  it("rejects a file containing an org_id column", () => {
    const result = parseMembers(
      "first_name,last_name,email,has_login,org_id\nAda,L,a@b.co,true,evil"
    );
    expect(result.error?.code).toBe("ORG_ID_COLUMN");
    // Zero data rows are read from a file that names a tenant.
    expect(result.rows).toEqual([]);
  });

  it("rejects a file missing a required column", () => {
    const result = parseMembers("first_name,email\nAda,a@b.co");
    expect(result.error?.code).toBe("MISSING_COLUMN");
    expect(result.error?.message).toContain("last_name");
  });

  it("rejects an empty file", () => {
    expect(parseMembers("").error?.code).toBe("EMPTY_FILE");
  });

  it("rejects a BOM-only file", () => {
    expect(parseMembers("﻿").error?.code).toBe("EMPTY_FILE");
  });

  it("rejects a header-only file", () => {
    const result = parseMembers("first_name,last_name,email,has_login\n");
    expect(result.error?.code).toBe("EMPTY_FILE");
  });

  it("aborts on an unterminated quote instead of importing a truncated file", () => {
    // Without the abort, the stray `"` on line 2 swallows Bob and Cy into
    // Ada's last_name cell, the short row reads every missing column as blank
    // — which means "not provided", not an error — and a three-person import
    // reports success having considered one row.
    const result = parseMembers(
      [
        "first_name,last_name,email,has_login",
        'Ada,"Love,lace,ada@x.com,true',
        "Bob,Smith,bob@x.com,true",
        "Cy,Jones,cy@x.com,true",
      ].join("\r\n")
    );
    expect(result.error?.code).toBe("UNTERMINATED_QUOTE");
    expect(result.error?.message).toContain("line 2");
    expect(result.rows).toEqual([]);
  });

  it("warns on a ragged row rather than reading the missing cells as deliberate blanks", () => {
    const result = parseMembers(
      "first_name,last_name,email,has_login\nAda,Lovelace"
    );
    expect(result.error).toBeUndefined();
    expect(
      result.warnings.some(
        (w) => w.line === 1 && w.message.includes("2 cells")
      )
    ).toBe(true);
    expect(result.rows).toHaveLength(1);
  });

  it("does not warn about raggedness on a well-formed file", () => {
    const result = parseMembers(
      "first_name,last_name,email,has_login\nAda,Lovelace,a@b.co,true"
    );
    expect(result.warnings).toEqual([]);
  });

  it("warns on an unknown column instead of erroring", () => {
    const result = parseMembers(
      "first_name,last_name,email,has_login,favorite_color\nAda,L,a@b.co,true,teal"
    );
    expect(result.error).toBeUndefined();
    expect(result.warnings.some((w) => w.message.includes("favorite_color"))).toBe(
      true
    );
    expect(result.rows).toHaveLength(1);
  });

  it("warns on a duplicate column and keeps the first occurrence", () => {
    const result = parseMembers(
      "first_name,last_name,email,has_login,first_name\nAda,L,a@b.co,true,Bee"
    );
    expect(result.error).toBeUndefined();
    expect(result.warnings.some((w) => w.message.includes("Duplicate"))).toBe(true);
    expect(result.rows[0].first_name).toBe("Ada");
  });
});

describe("parseMembers cell coercion", () => {
  const HEADER = "first_name,last_name,email,has_login";

  it("coerces the documented boolean spellings", () => {
    const result = parseMembers(
      [
        `${HEADER},is_unlisted`,
        "A,x,,false,true",
        "B,x,,false,yes",
        "C,x,,false,1",
        "D,x,,false,false",
        "E,x,,false,no",
        "F,x,,false,0",
        "G,x,,false,",
      ].join("\n")
    );
    expect(result.rows.map((r) => r.is_unlisted)).toEqual([
      true,
      true,
      true,
      false,
      false,
      false,
      null,
    ]);
  });

  it("warns on an unrecognized boolean and treats it as blank", () => {
    const result = parseMembers(`${HEADER},is_unlisted\nA,x,,false,maybe`);
    expect(result.rows[0].is_unlisted).toBeNull();
    expect(result.warnings.some((w) => w.line === 1)).toBe(true);
  });

  it("defaults blank has_login to whether the email cell is non-empty", () => {
    const result = parseMembers(`${HEADER}\nA,x,a@b.co,\nB,x,,`);
    expect(result.rows[0].has_login).toBe(true);
    expect(result.rows[1].has_login).toBe(false);
  });

  it("parses birth parts as integers and blank as null", () => {
    const result = parseMembers(
      `${HEADER},birth_month,birth_day,birth_year\nA,x,,false,4,30,`
    );
    expect(result.rows[0].birth_month).toBe(4);
    expect(result.rows[0].birth_day).toBe(30);
    expect(result.rows[0].birth_year).toBeNull();
  });

  it("carries a non-integer birth part as NaN for the planner to reject", () => {
    const result = parseMembers(`${HEADER},birth_month\nA,x,,false,April`);
    expect(Number.isNaN(result.rows[0].birth_month)).toBe(true);
  });

  it("splits groups and leads on | and drops empty segments", () => {
    const result = parseMembers(
      `${HEADER},groups,leads\nA,x,,false,"Worship||Hospitality|","Worship|"`
    );
    expect(result.rows[0].groups).toEqual(["Worship", "Hospitality"]);
    expect(result.rows[0].leads).toEqual(["Worship"]);
  });

  it("warns when leads names are missing from groups and treats them as memberships", () => {
    const result = parseMembers(`${HEADER},groups,leads\nA,x,,false,Worship,Choir`);
    expect(result.warnings.some((w) => w.message.includes("Choir"))).toBe(true);
    expect(result.rows[0].groups).toEqual(["Worship", "Choir"]);
    expect(result.rows[0].leads).toEqual(["Choir"]);
  });

  it("drops unknown hidden_fields tokens with a warning", () => {
    const result = parseMembers(
      `${HEADER},hidden_fields\nA,x,,false,email|shoe_size`
    );
    expect(result.rows[0].hidden_fields).toEqual(["email"]);
    expect(result.warnings.some((w) => w.message.includes("shoe_size"))).toBe(true);
  });

  it("skips fully blank rows without shifting later line numbers", () => {
    const result = parseMembers(`${HEADER}\nA,x,,false\n,,,\nB,x,,false`);
    expect(result.rows.map((r) => [r.line, r.first_name])).toEqual([
      [1, "A"],
      [3, "B"],
    ]);
  });

  it("unguards then trims each cell", () => {
    const result = parseMembers(`${HEADER}\n"'=Evil",x,,false`);
    expect(result.rows[0].first_name).toBe("=Evil");
  });
});

describe("memberRowsFromSnapshot", () => {
  it("returns no rows for an empty org", () => {
    expect(memberRowsFromSnapshot(emptySnapshot)).toEqual([]);
  });

  it("orders households by family_name, primaries first within a household, unhoused last", () => {
    const snapshot: OrgSnapshot = {
      ...emptySnapshot,
      families: [
        { id: "f2", family_name: "Zeta" },
        { id: "f1", family_name: "Alpha" },
      ],
      profiles: [
        {
          id: "p3",
          email: "solo@example.org",
          role: "member",
          relationship: "primary",
          first_name: "Solo",
          last_name: "Unhoused",
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
        },
        {
          id: "p2",
          email: "spouse@example.org",
          role: "member",
          relationship: "spouse",
          first_name: "Spouse",
          last_name: "Alpha",
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
          family_id: "f1",
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
        },
        {
          id: "p1",
          email: "primary@example.org",
          role: "admin",
          relationship: "primary",
          first_name: "Primary",
          last_name: "Alpha",
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
          family_id: "f1",
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
        },
      ],
      familyMembers: [
        {
          id: "m1",
          family_id: "f2",
          first_name: "Kid",
          last_name: "Zeta",
          preferred_name: null,
          birth_month: 2,
          birth_day: 2,
          birth_year: 2015,
          relationship: "child",
          is_class_member: false,
        },
      ],
    };
    const rows = memberRowsFromSnapshot(snapshot);
    expect(
      rows.map((r) => [r.first_name, r.household_key, r.household_primary])
    ).toEqual([
      ["Primary", "hh-1", true],
      ["Spouse", "hh-1", false],
      ["Kid", "hh-2", false],
      ["Solo", null, false],
    ]);
    // Lines are sequential so parse(serialize(x)) is stable.
    expect(rows.map((r) => r.line)).toEqual([1, 2, 3, 4]);
  });

  it("exports hide_* flags as canonical hidden_fields tokens", () => {
    const snapshot: OrgSnapshot = {
      ...emptySnapshot,
      profiles: [
        {
          id: "p1",
          email: "a@example.org",
          role: "member",
          relationship: "primary",
          first_name: "A",
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
          hide_email: true,
          hide_phone_mobile: false,
          hide_phone_home: false,
          hide_phone_work: false,
          hide_address: true,
          hide_birthday: false,
          hide_birth_year: false,
          hide_anniversary: false,
          hide_occupation: true,
        },
      ],
    };
    expect(memberRowsFromSnapshot(snapshot)[0].hidden_fields).toEqual([
      "email",
      "address",
      "occupation",
    ]);
    expect(HIDDEN_FIELD_TOKENS).toHaveLength(9);
  });
});
