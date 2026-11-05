// The import matches a row to a person by address, and the addresses come
// only from the church admin read. A hidden address has to match like any
// other, and a failed read has to stop the import: planned against no
// addresses, every row is a new person.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeRosterClient, HIDDEN_ADDRESS, HIDDEN_ROSTER } from "@/lib/members/rosterTestHelpers";

const requireOrgAdmin = vi.fn();
vi.mock("@/lib/members/access", () => ({
  requireOrgAdmin: () => requireOrgAdmin(),
}));

const { GET } = await import("@/app/api/admin/members/export/route");
const { POST } = await import("@/app/api/admin/members/import/route");

function asAdmin(client: unknown) {
  requireOrgAdmin.mockResolvedValue({ ok: true, user: { id: "admin-1" }, orgId: "org-1", supabase: client });
}

function upload(csv: string, mode: "validate" | "apply") {
  return POST(
    new Request(`http://localhost/api/admin/members/import?mode=${mode}`, {
      method: "POST",
      headers: { "Content-Type": "text/csv" },
      body: csv,
    }),
  );
}

/** The file the export hands a church admin for the one-person roster. */
async function exportedCsv() {
  asAdmin(fakeRosterClient({ tables: HIDDEN_ROSTER, addresses: { data: [HIDDEN_ADDRESS], error: null } }).client);
  return (await GET()).text();
}

beforeEach(() => {
  requireOrgAdmin.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/admin/members/import", () => {
  it("matches a person who hides their email instead of planning a new one", async () => {
    const csv = await exportedCsv();
    asAdmin(fakeRosterClient({ tables: HIDDEN_ROSTER, addresses: { data: [HIDDEN_ADDRESS], error: null } }).client);

    const res = await upload(csv, "validate");

    expect(res.status).toBe(200);
    expect((await res.json()).summary).toMatchObject({ rows: 1, create: 0, error: 0, noChange: 1 });
  });

  it("does not match that person when the read returns no address for them", async () => {
    const csv = await exportedCsv();
    asAdmin(fakeRosterClient({ tables: HIDDEN_ROSTER, addresses: { data: [], error: null } }).client);

    const res = await upload(csv, "validate");

    expect((await res.json()).summary.noChange).toBe(0);
  });

  it("answers 500 and writes nothing when the addresses can't be read", async () => {
    const csv = await exportedCsv();
    const fake = fakeRosterClient({ tables: HIDDEN_ROSTER, addresses: { data: null, error: { code: "42501" } } });
    asAdmin(fake.client);

    const res = await upload(csv, "apply");

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to load member data" });
    expect(fake.writes).toEqual([]);
  });
});
