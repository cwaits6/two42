// A church admin's failed add answers with fixed copy; the database's own
// text, which names tables, columns and policies, stays out.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectSchemaHidden, fakeQueryClient, SCHEMA_REVEALING_ERROR, type QueryAnswer } from "@/lib/supabase/testing";

const db: { answers: Record<string, QueryAnswer[]>; inserted: unknown[] } = {
  answers: {},
  inserted: [],
};
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    const client = fakeQueryClient(db.answers);
    return {
      ...client,
      from(table: string) {
        const query = client.from(table) as Record<string, unknown>;
        if (table !== "family_members") return query;
        return {
          insert(row: unknown) {
            db.inserted.push(row);
            return (query.insert as (r: unknown) => unknown)(row);
          },
        };
      },
    };
  },
}));

const failed = { data: null, error: SCHEMA_REVEALING_ERROR };
const admin = { data: { role: "admin" }, error: null };
let log: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.restoreAllMocks();
  log = vi.spyOn(console, "log").mockImplementation(() => {});
});

const { POST } = await import("./route");

describe("POST /api/admin/family-members when the database refuses", () => {
  it("answers 500 with fixed copy", async () => {
    db.answers = { profiles: [admin], family_members: [failed] };
    const req = new Request("http://localhost/api/admin/family-members", {
      method: "POST",
      body: JSON.stringify({ family_id: "fam-1", first_name: "Ruth", relationship: "child" }),
    });
    await expectSchemaHidden(await POST(req), log, {
      status: 500,
      error: "Couldn't add them to the household. Try again.",
      what: "family-members POST error",
      route: "/api/admin/family-members",
    });
  });
});

describe("POST /api/admin/family-members names", () => {
  function post(body: Record<string, unknown>) {
    return POST(
      new Request("http://localhost/api/admin/family-members", {
        method: "POST",
        body: JSON.stringify({ family_id: "fam-1", relationship: "child", ...body }),
      }),
    );
  }

  it("saves the names capitalized", async () => {
    db.answers = { profiles: [admin], family_members: [{ data: { id: "fm-1" }, error: null }] };
    db.inserted = [];

    expect((await post({ first_name: "john", last_name: "MCDONALD" })).status).toBe(201);
    expect(db.inserted).toEqual([
      expect.objectContaining({ first_name: "John", last_name: "McDonald", preferred_name: null }),
    ]);
  });

  it("refuses an empty first name or an over-long last name on the field", async () => {
    db.answers = { profiles: [admin, admin] };

    const empty = await post({ first_name: "  " });
    expect(empty.status).toBe(400);
    expect(await empty.json()).toEqual({ fieldErrors: { first_name: "Enter a first name." } });

    const long = await post({ first_name: "Ruth", last_name: "x".repeat(101) });
    expect(long.status).toBe(400);
    expect(await long.json()).toEqual({
      fieldErrors: { last_name: "Use 100 characters or fewer." },
    });
  });
});
