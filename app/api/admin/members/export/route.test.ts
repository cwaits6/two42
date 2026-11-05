// The export reads every address through the church admin read, hidden ones
// included, and refuses to hand out a file when that read fails: a roster
// with blank addresses looks complete and is not.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeRosterClient, HIDDEN_ADDRESS, HIDDEN_ROSTER } from "@/lib/members/rosterTestHelpers";

const requireOrgAdmin = vi.fn();
vi.mock("@/lib/members/access", () => ({
  requireOrgAdmin: () => requireOrgAdmin(),
}));

const { GET } = await import("@/app/api/admin/members/export/route");

function asAdmin(client: unknown) {
  requireOrgAdmin.mockResolvedValue({ ok: true, user: { id: "admin-1" }, orgId: "org-1", supabase: client });
}

beforeEach(() => {
  requireOrgAdmin.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/admin/members/export", () => {
  it("includes the email of a person who hides it", async () => {
    asAdmin(fakeRosterClient({ tables: HIDDEN_ROSTER, addresses: { data: [HIDDEN_ADDRESS], error: null } }).client);

    const res = await GET();

    expect(res.status).toBe(200);
    const [header, row] = (await res.text()).trim().split(/\r?\n/);
    const cells = Object.fromEntries(header.split(",").map((name, i) => [name, row.split(",")[i]]));
    expect(cells).toMatchObject({ first_name: "Chloe", email: "chloe@example.test" });
  });

  it("answers 500 with no file when the addresses can't be read", async () => {
    asAdmin(fakeRosterClient({ tables: HIDDEN_ROSTER, addresses: { data: null, error: { code: "42501" } } }).client);

    const res = await GET();

    expect(res.status).toBe(500);
    expect(await res.text()).toBe("Failed to build export");
    expect(res.headers.get("Content-Disposition")).toBeNull();
  });
});
