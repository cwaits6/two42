// A church admin's failed save or removal answers with fixed copy; the
// database's own text, which names tables, columns and policies, stays out.

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

const { PATCH, DELETE } = await import("./route");

const params = { params: Promise.resolve({ id: "fm-1" }) };

describe("/api/admin/family-members/[id] when the database refuses", () => {
  it("PATCH answers 500 with fixed copy", async () => {
    db.answers = { profiles: [admin], family_members: [failed] };
    const req = new Request("http://localhost/api/admin/family-members/fm-1", {
      method: "PATCH",
      body: JSON.stringify({ first_name: "Ruth" }),
    });
    await expectSchemaHidden(await PATCH(req, params), log, {
      status: 500,
      error: "Couldn't save their details. Try again.",
      what: "family-members PATCH error",
      route: "/api/admin/family-members/[id]",
    });
  });

  it("DELETE answers 500 with fixed copy", async () => {
    db.answers = { profiles: [admin], family_members: [failed] };
    const req = new Request("http://localhost/api/admin/family-members/fm-1", { method: "DELETE" });
    await expectSchemaHidden(await DELETE(req, params), log, {
      status: 500,
      error: "Couldn't remove them from the household. Try again.",
      what: "family-members DELETE error",
      route: "/api/admin/family-members/[id]",
    });
  });
});
