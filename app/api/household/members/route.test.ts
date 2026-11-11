// A failed read or add of household members answers with fixed copy; the
// database's own text, which names tables, columns and policies, stays out.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectSchemaHidden, fakeQueryClient, SCHEMA_REVEALING_ERROR, type QueryAnswer } from "@/lib/supabase/testing";

const db: { answers: Record<string, QueryAnswer[]> } = { answers: {} };
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => fakeQueryClient(db.answers),
}));

const failed = { data: null, error: SCHEMA_REVEALING_ERROR };
const primary = { data: { role: "member", family_id: "fam-1", setup_completed: true, relationship: "primary" }, error: null };
let log: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.restoreAllMocks();
  log = vi.spyOn(console, "log").mockImplementation(() => {});
});

const { GET, POST } = await import("./route");

describe("/api/household/members when the database refuses", () => {
  it("GET answers 500 with fixed copy", async () => {
    db.answers = { profiles: [primary], family_members: [failed] };
    await expectSchemaHidden(await GET(), log, {
      status: 500,
      error: "Couldn't load your household. Try again.",
      what: "household/members GET error",
      route: "/api/household/members",
    });
  });

  it("POST answers 500 with fixed copy", async () => {
    db.answers = { profiles: [primary], family_members: [failed] };
    const req = new Request("http://localhost/api/household/members", {
      method: "POST",
      body: JSON.stringify({ first_name: "Ruth", relationship: "child" }),
    });
    await expectSchemaHidden(await POST(req), log, {
      status: 500,
      error: "Couldn't add them to your household. Try again.",
      what: "household/members POST error",
      route: "/api/household/members",
    });
  });
});

describe("POST /api/household/members names", () => {
  it("refuses an empty first name or an over-long name on the field", async () => {
    db.answers = { profiles: [primary, primary] };
    const post = (body: Record<string, unknown>) =>
      POST(
        new Request("http://localhost/api/household/members", {
          method: "POST",
          body: JSON.stringify({ relationship: "child", ...body }),
        }),
      );

    const empty = await post({ first_name: "" });
    expect(empty.status).toBe(400);
    expect(await empty.json()).toEqual({ fieldErrors: { first_name: "Enter a first name." } });

    const long = await post({ first_name: "Ruth", preferred_name: "x".repeat(101) });
    expect(long.status).toBe(400);
    expect(await long.json()).toEqual({
      fieldErrors: { preferred_name: "Use 100 characters or fewer." },
    });
  });
});
