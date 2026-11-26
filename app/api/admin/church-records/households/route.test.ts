import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireOrgAdmin = vi.fn();
vi.mock("@/lib/members/access", () => ({ requireOrgAdmin: () => requireOrgAdmin() }));

const store = vi.hoisted(() => ({
  readConnection: vi.fn(),
  readHouseholdsStatus: vi.fn(),
  readyHouseholdSuggestions: vi.fn(),
  saveChildrenSetting: vi.fn(),
  confirmHousehold: vi.fn(),
}));
vi.mock("@/lib/integrations/records/store", () => store);

const providers = vi.hoisted(() => ({ providerFor: vi.fn() }));
vi.mock("@/lib/integrations/records/providers", () => providers);

import { GET, POST, PUT } from "./route";

const CONNECTION = { provider: "rock", baseUrl: "https://rock.example.org", keyHint: "9012", connectedAt: "2026-11-20T00:00:00Z" };
const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";

const send = (handler: (request: Request) => Promise<Response>, body: unknown) =>
  handler(new Request("http://test/api/admin/church-records/households", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  process.env.RECORDS_KEY_SECRET = randomBytes(32).toString("base64");
  requireOrgAdmin.mockResolvedValue({ ok: true, orgId: "org-1", user: { id: "admin-1" } });
  store.readConnection.mockResolvedValue(CONNECTION);
  providers.providerFor.mockReturnValue({ copy: { households: {} } });
  store.readHouseholdsStatus.mockResolvedValue({
    suggestChildren: false,
    lastRefreshedAt: null,
    householdsUnavailable: false,
    suggestions: [],
  });
  store.readyHouseholdSuggestions.mockResolvedValue(new Set([A, B]));
  store.confirmHousehold.mockResolvedValue("confirmed");
  store.saveChildrenSetting.mockResolvedValue("saved");
});

describe("/api/admin/church-records/households", () => {
  it("doesn't exist without the secret, a connection, or a provider that reads families", async () => {
    delete process.env.RECORDS_KEY_SECRET;
    expect((await GET()).status).toBe(404);
    process.env.RECORDS_KEY_SECRET = randomBytes(32).toString("base64");
    store.readConnection.mockResolvedValue(null);
    expect((await GET()).status).toBe(404);
    store.readConnection.mockResolvedValue(CONNECTION);
    providers.providerFor.mockReturnValue({ copy: {} });
    expect((await GET()).status).toBe(404);
    expect((await send(PUT, { suggestChildren: true })).status).toBe(404);
    expect((await send(POST, { suggestions: [A] })).status).toBe(404);
    expect(store.saveChildrenSetting).not.toHaveBeenCalled();
    expect(store.confirmHousehold).not.toHaveBeenCalled();
  });

  it("turns away anyone but a church admin", async () => {
    requireOrgAdmin.mockResolvedValue({ ok: false, status: 403 });
    expect((await GET()).status).toBe(403);
    expect((await send(PUT, { suggestChildren: true })).status).toBe(403);
    expect((await send(POST, { suggestions: [A] })).status).toBe(403);
    expect(store.confirmHousehold).not.toHaveBeenCalled();
  });

  it("reads the admin's own church", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(store.readHouseholdsStatus).toHaveBeenCalledWith("org-1");
  });

  it("saves the children switch for the admin's church, and refuses anything but true or false", async () => {
    expect((await send(PUT, { suggestChildren: "yes" })).status).toBe(400);
    const res = await send(PUT, { suggestChildren: true });
    expect(await res.json()).toEqual({ suggestChildren: true });
    expect(store.saveChildrenSetting).toHaveBeenCalledWith("org-1", true, "admin-1");
  });

  it("answers 409 for the children switch while a refresh runs, since that run keeps the old one", async () => {
    store.saveChildrenSetting.mockResolvedValue("busy");
    const res = await send(PUT, { suggestChildren: false });
    expect(res.status).toBe(409);
    expect(await res.json()).not.toHaveProperty("suggestChildren");
  });

  it("refuses a bulk confirm holding any suggestion under Check first", async () => {
    store.readyHouseholdSuggestions.mockResolvedValue(new Set([A]));
    const res = await send(POST, { suggestions: [A, B] });
    expect(res.status).toBe(400);
    expect(store.readyHouseholdSuggestions).toHaveBeenCalledWith("org-1", [A, B]);
    expect(store.confirmHousehold).not.toHaveBeenCalled();
  });

  it("refuses ids that aren't suggestion ids, and more than 100", async () => {
    expect((await send(POST, { suggestions: [] })).status).toBe(400);
    expect((await send(POST, { suggestions: ["not-an-id"] })).status).toBe(400);
    expect((await send(POST, { suggestions: Array(101).fill(A) })).status).toBe(400);
    expect(store.confirmHousehold).not.toHaveBeenCalled();
  });

  it("confirms each in the admin's church and counts the ones that changed", async () => {
    store.confirmHousehold.mockResolvedValueOnce("confirmed").mockResolvedValueOnce("stale");
    const res = await send(POST, { suggestions: [A, B] });
    expect(await res.json()).toEqual({ confirmed: 1, changed: 1 });
    expect(store.confirmHousehold).toHaveBeenCalledWith("org-1", A, "admin-1");
    expect(store.confirmHousehold).toHaveBeenCalledWith("org-1", B, "admin-1");
  });

  it("answers 409 for a single suggestion that changed, or while a refresh runs", async () => {
    store.confirmHousehold.mockResolvedValue("stale");
    expect((await send(POST, { suggestions: [A] })).status).toBe(409);
    store.confirmHousehold.mockResolvedValue("gone");
    expect((await send(POST, { suggestions: [A] })).status).toBe(409);
    store.confirmHousehold.mockResolvedValue("busy");
    const busy = await send(POST, { suggestions: [A, B] });
    expect(busy.status).toBe(409);
    expect(await busy.json()).toMatchObject({ confirmed: 0 });
    expect(store.confirmHousehold).toHaveBeenCalledTimes(3);
  });
});
