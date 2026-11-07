// A church admin's failed add answers with fixed copy; the database's own
// text, which names tables, columns and policies, stays out.

import { beforeEach, describe, it, vi } from "vitest";
import { expectSchemaHidden, fakeQueryClient, SCHEMA_REVEALING_ERROR, type QueryAnswer } from "@/lib/supabase/testing";

const db: { answers: Record<string, QueryAnswer[]> } = { answers: {} };
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => fakeQueryClient(db.answers),
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
