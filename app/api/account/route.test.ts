import { beforeEach, describe, expect, it, vi } from "vitest";

const currentPerson = vi.fn();
vi.mock("@/lib/account/currentPerson", () => ({ currentPerson: () => currentPerson() }));

const deletePerson = vi.fn();
const loadDeletionSummary = vi.fn();
vi.mock("@/lib/account/deletion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/account/deletion")>()),
  deletePerson: (...args: unknown[]) => deletePerson(...args),
  loadDeletionSummary: (...args: unknown[]) => loadDeletionSummary(...args),
}));

vi.mock("@/lib/supabase/server", () => ({ createServiceClient: vi.fn(), createClient: vi.fn() }));

const account = await import("./route");
const member = await import("@/app/api/admin/members/[id]/route");

const requireOrgAdmin = vi.fn();
vi.mock("@/lib/members/access", () => ({ requireOrgAdmin: () => requireOrgAdmin() }));

const TARGET = "a0000000-0000-4000-8000-000000000002";
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const request = new Request("http://localhost/");

beforeEach(() => {
  vi.clearAllMocks();
  deletePerson.mockResolvedValue("deleted");
});

describe("DELETE /api/account", () => {
  const signOut = vi.fn(async () => undefined);
  const me = { ok: true, id: "me", orgId: "org-1", signOut };

  it("acts on the session's person and org, and takes no target from the request", async () => {
    currentPerson.mockResolvedValue(me);
    const res = await account.DELETE();
    expect(res.status).toBe(200);
    expect(deletePerson).toHaveBeenCalledExactlyOnceWith("org-1", "me");
    expect(account.DELETE).toHaveLength(0);
    expect(signOut).toHaveBeenCalledOnce();
  });

  it("refuses without a session, deleting nothing", async () => {
    currentPerson.mockResolvedValue({ ok: false, status: 401 });
    expect((await account.DELETE()).status).toBe(401);
    expect(deletePerson).not.toHaveBeenCalled();
  });

  it("reports the last church admin and stays signed in", async () => {
    currentPerson.mockResolvedValue(me);
    deletePerson.mockResolvedValue("last_church_admin");
    expect((await account.DELETE()).status).toBe(409);
    expect(signOut).not.toHaveBeenCalled();
  });

  it("reports failure and stays signed in, so a retry can finish", async () => {
    currentPerson.mockResolvedValue(me);
    deletePerson.mockResolvedValue("failed");
    expect((await account.DELETE()).status).toBe(500);
    expect(signOut).not.toHaveBeenCalled();
  });

  it("still reports success when the dead session can't be signed out", async () => {
    currentPerson.mockResolvedValue({ ...me, signOut: async () => Promise.reject(new Error("x")) });
    expect((await account.DELETE()).status).toBe(200);
  });
});

describe("DELETE /api/admin/members/[id]", () => {
  it("refuses a member, deleting nothing", async () => {
    requireOrgAdmin.mockResolvedValue({ ok: false, status: 403 });
    expect((await member.DELETE(request, params(TARGET))).status).toBe(403);
    expect(deletePerson).not.toHaveBeenCalled();
  });

  it("refuses without a session, deleting nothing", async () => {
    requireOrgAdmin.mockResolvedValue({ ok: false, status: 401 });
    expect((await member.DELETE(request, params(TARGET))).status).toBe(401);
    expect(deletePerson).not.toHaveBeenCalled();
  });

  it("scopes the deletion to the admin's own org", async () => {
    requireOrgAdmin.mockResolvedValue({ ok: true, orgId: "org-1" });
    expect((await member.DELETE(request, params(TARGET))).status).toBe(200);
    expect(deletePerson).toHaveBeenCalledExactlyOnceWith("org-1", TARGET);
  });

  it("answers 404 for someone in another church", async () => {
    requireOrgAdmin.mockResolvedValue({ ok: true, orgId: "org-1" });
    deletePerson.mockResolvedValue("not_found");
    expect((await member.DELETE(request, params(TARGET))).status).toBe(404);
  });

  it("answers 409 when the person is the last church admin", async () => {
    requireOrgAdmin.mockResolvedValue({ ok: true, orgId: "org-1" });
    deletePerson.mockResolvedValue("last_church_admin");
    expect((await member.DELETE(request, params(TARGET))).status).toBe(409);
  });

  it("answers 404 for an id that isn't one, without looking", async () => {
    requireOrgAdmin.mockResolvedValue({ ok: true, orgId: "org-1" });
    expect((await member.DELETE(request, params("nope"))).status).toBe(404);
    expect(deletePerson).not.toHaveBeenCalled();
  });

  it("gives a member no summary of someone else", async () => {
    requireOrgAdmin.mockResolvedValue({ ok: false, status: 403 });
    expect((await member.GET(request, params(TARGET))).status).toBe(403);
    expect(loadDeletionSummary).not.toHaveBeenCalled();
  });
});

describe("GET /api/account", () => {
  it("reads the summary for the session's own person", async () => {
    currentPerson.mockResolvedValue({ ok: true, id: "me", orgId: "org-1", signOut: vi.fn() });
    loadDeletionSummary.mockResolvedValue({ name: "Me" });
    const res = await account.GET();
    expect(await res.json()).toEqual({ name: "Me" });
    expect(loadDeletionSummary).toHaveBeenCalledExactlyOnceWith("org-1", "me");
  });

  it("reports a failed read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    currentPerson.mockResolvedValue({ ok: true, id: "me", orgId: "org-1", signOut: vi.fn() });
    loadDeletionSummary.mockRejectedValue(new Error("x"));
    expect((await account.GET()).status).toBe(500);
  });
});
