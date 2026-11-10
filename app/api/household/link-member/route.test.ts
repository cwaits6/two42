// A failed link answers with fixed copy; the database's own text, which names
// tables, columns and policies, stays out.

import { beforeEach, describe, it, vi } from "vitest";
import { expectSchemaHidden, fakeQueryClient, SCHEMA_REVEALING_ERROR, type QueryAnswer } from "@/lib/supabase/testing";

const db: { answers: Record<string, QueryAnswer[]>; service: Record<string, QueryAnswer[]> } = {
  answers: {},
  service: {},
};
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => fakeQueryClient(db.answers),
  createServiceClient: async () => fakeQueryClient(db.service, null),
}));

const { POST } = await import("./route");

let log: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.restoreAllMocks();
  log = vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("POST /api/household/link-member when the database refuses", () => {
  it("answers 500 with fixed copy", async () => {
    db.answers = {
      profiles: [
        { data: { org_id: "org-1", role: "member", family_id: "fam-1", setup_completed: true, relationship: "primary" }, error: null },
        { data: { id: "p-2", org_id: "org-1", family_id: null, role: "member", setup_completed: true }, error: null },
      ],
    };
    db.service = { profiles: [{ data: null, error: SCHEMA_REVEALING_ERROR }] };
    const req = new Request("http://localhost/api/household/link-member", {
      method: "POST",
      body: JSON.stringify({ profile_id: "p-2", relationship: "child" }),
    });
    await expectSchemaHidden(await POST(req), log, {
      status: 500,
      error: "Couldn't add them to your household. Try again.",
      what: "link-member error",
      route: "/api/household/link-member",
    });
  });
});
