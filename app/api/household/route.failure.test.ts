// A failed read or save of the household answers with fixed copy; the
// database's own text, which names tables, columns and policies, stays out.

import { beforeEach, describe, it, vi } from "vitest";
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

const { GET, PATCH } = await import("./route");

describe("/api/household when the database refuses", () => {
  it("GET answers 500 with fixed copy", async () => {
    db.answers = { profiles: [primary], family_units: [failed] };
    await expectSchemaHidden(await GET(), log, {
      status: 500,
      error: "Couldn't load your household. Try again.",
      what: "household GET error",
      route: "/api/household",
    });
  });

  it("PATCH answers 500 with fixed copy", async () => {
    db.answers = { profiles: [primary], family_units: [failed] };
    const req = new Request("http://localhost/api/household", {
      method: "PATCH",
      body: JSON.stringify({ address_line1: "1 Main St" }),
    });
    await expectSchemaHidden(await PATCH(req), log, {
      status: 500,
      error: "Couldn't save the household. Try again.",
      what: "household PATCH error",
      route: "/api/household",
    });
  });
});
