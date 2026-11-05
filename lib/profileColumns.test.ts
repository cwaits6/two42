import { describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { PROFILE_COLUMNS, withEmail, type ProfileColumns } from "./profileColumns";

// A Profile field missing here fails tsc, so the list cannot fall behind the type.
const FIELDS: Record<keyof ProfileColumns, true> = {
  id: true,
  first_name: true,
  last_name: true,
  preferred_name: true,
  role: true,
  avatar_url: true,
  phone: true,
  phone_mobile: true,
  phone_home: true,
  phone_work: true,
  bio: true,
  address_line1: true,
  address_line2: true,
  city: true,
  state: true,
  postal_code: true,
  birth_month: true,
  birth_day: true,
  birth_year: true,
  occupation: true,
  employer: true,
  family_id: true,
  is_unlisted: true,
  hide_email: true,
  relationship: true,
  email_announcements: true,
  email_event_reminders: true,
  setup_completed: true,
  approved_at: true,
  approved_by: true,
  created_at: true,
  updated_at: true,
};

// A Profile field that is not a column of the table fails tsc: the select
// would ask the database for a column it does not have.
const COLUMN_NAMES: readonly (keyof Database["public"]["Tables"]["profiles"]["Row"])[] = Object.keys(
  FIELDS,
) as (keyof ProfileColumns)[];

describe("PROFILE_COLUMNS", () => {
  const columns = PROFILE_COLUMNS.split(",").map((c) => c.trim());

  it("lists every profile field except the address", () => {
    expect([...columns].sort()).toEqual([...COLUMN_NAMES].sort());
  });

  it("never asks for the address or for all columns", () => {
    expect(columns).not.toContain("email");
    expect(columns).not.toContain("*");
  });
});

describe("withEmail", () => {
  it("adds the address without changing the row", () => {
    const row = { id: "p1", first_name: "Chloe" } as ProfileColumns;
    expect(withEmail(row, "chloe@example.test")).toEqual({
      id: "p1",
      first_name: "Chloe",
      email: "chloe@example.test",
    });
    expect(withEmail(row, null).email).toBeNull();
  });
});
