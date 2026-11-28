// A failed link answers with fixed copy; the database's own text, which names
// tables, columns and policies, stays out. A link made restarts the person's
// church records copy, and a failure there never undoes the link.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectSchemaHidden, fakeQueryClient, SCHEMA_REVEALING_ERROR, type QueryAnswer } from "@/lib/supabase/testing";

const db: { answers: Record<string, QueryAnswer[]>; service: Record<string, QueryAnswer[]> } = {
  answers: {},
  service: {},
};
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => fakeQueryClient(db.answers),
  createServiceClient: async () => fakeQueryClient(db.service, null),
}));

const records = vi.hoisted(() => ({ drop: vi.fn(async () => true), copy: vi.fn(async () => {}) }));
vi.mock("@/lib/integrations/records/householdMove", () => ({
  dropAnniversarySourceBeforeMove: records.drop,
  copyInFullAfterMove: records.copy,
}));

const { POST } = await import("./route");

const CALLER = { org_id: "org-1", role: "member", family_id: "fam-1", setup_completed: true, relationship: "primary" };
const TARGET = { id: "p-2", org_id: "org-1", family_id: null, role: "member", setup_completed: true };
const link = () =>
  POST(
    new Request("http://localhost/api/household/link-member", {
      method: "POST",
      body: JSON.stringify({ profile_id: "p-2", relationship: "child" }),
    }),
  );

let log: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.restoreAllMocks();
  records.drop.mockReset().mockResolvedValue(true);
  records.copy.mockClear();
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

describe("POST /api/household/link-member and the church's records", () => {
  const ARGS = [expect.anything(), "org-1", "p-2", "/api/household/link-member"];

  it("drops the person's anniversary source, links them, then asks for a full copy, in the caller's church", async () => {
    db.answers = { profiles: [{ data: CALLER, error: null }, { data: TARGET, error: null }] };
    db.service = { profiles: [{ data: [{ id: "p-2" }], error: null }] };

    expect((await link()).status).toBe(200);
    expect(records.drop).toHaveBeenCalledExactlyOnceWith(...ARGS);
    expect(records.copy).toHaveBeenCalledExactlyOnceWith(...ARGS);
    expect(records.drop.mock.invocationCallOrder[0]).toBeLessThan(records.copy.mock.invocationCallOrder[0]);
  });

  it("links them without asking for a full copy when dropping the source failed", async () => {
    records.drop.mockResolvedValue(false);
    db.answers = { profiles: [{ data: CALLER, error: null }, { data: TARGET, error: null }] };
    db.service = { profiles: [{ data: [{ id: "p-2" }], error: null }] };

    expect((await link()).status).toBe(200);
    expect(records.copy).not.toHaveBeenCalled();
  });

  it("asks for no full copy when someone else linked them first", async () => {
    db.answers = { profiles: [{ data: CALLER, error: null }, { data: TARGET, error: null }] };
    db.service = { profiles: [{ data: [], error: null }] };

    expect((await link()).status).toBe(409);
    expect(records.copy).not.toHaveBeenCalled();
  });

  it("refuses someone already in a household without touching their records", async () => {
    db.answers = { profiles: [{ data: CALLER, error: null }, { data: { ...TARGET, family_id: "fam-2" }, error: null }] };

    expect((await link()).status).toBe(409);
    expect(records.drop).not.toHaveBeenCalled();
    expect(records.copy).not.toHaveBeenCalled();
  });
});
