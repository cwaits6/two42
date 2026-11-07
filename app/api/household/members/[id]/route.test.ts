// A failed save or removal of a household member answers with fixed copy; the
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

const { PATCH, DELETE } = await import("./route");

const own = { data: { family_id: "fam-1" }, error: null };
const params = { params: Promise.resolve({ id: "fm-1" }) };

describe("/api/household/members/[id] when the database refuses", () => {
  it("PATCH answers 500 with fixed copy", async () => {
    db.answers = { profiles: [primary], family_members: [own, failed] };
    const req = new Request("http://localhost/api/household/members/fm-1", {
      method: "PATCH",
      body: JSON.stringify({ first_name: "Ruth" }),
    });
    await expectSchemaHidden(await PATCH(req, params), log, {
      status: 500,
      error: "Couldn't save their details. Try again.",
      what: "household/members PATCH error",
      route: "/api/household/members/[id]",
    });
  });

  it("DELETE answers 500 with fixed copy", async () => {
    db.answers = { profiles: [primary], family_members: [own, failed] };
    const req = new Request("http://localhost/api/household/members/fm-1", { method: "DELETE" });
    await expectSchemaHidden(await DELETE(req, params), log, {
      status: 500,
      error: "Couldn't remove them from your household. Try again.",
      what: "household/members DELETE error",
      route: "/api/household/members/[id]",
    });
  });
});
