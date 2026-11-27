import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireOrgAdmin = vi.fn();
vi.mock("@/lib/members/access", () => ({ requireOrgAdmin: () => requireOrgAdmin() }));

const store = vi.hoisted(() => ({
  readConnection: vi.fn(),
  readMode: vi.fn(),
  liveCopiedCount: vi.fn(),
  saveMode: vi.fn(),
  isRecordsMode: (value: unknown) => value === "copy" || value === "live",
}));
vi.mock("@/lib/integrations/records/store", () => store);

import { GET, PUT } from "./route";

const CONNECTION = { provider: "rock", baseUrl: "https://rock.example.org", keyHint: "9012", connectedAt: "2026-11-20T00:00:00Z" };

function put(body: unknown) {
  return PUT(new Request("http://test/api/admin/church-records/mode", { method: "PUT", body: JSON.stringify(body) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.RECORDS_KEY_SECRET = randomBytes(32).toString("base64");
  requireOrgAdmin.mockResolvedValue({ ok: true, orgId: "org-1", user: { id: "admin-1" } });
  store.readConnection.mockResolvedValue(CONNECTION);
  store.readMode.mockResolvedValue({ mode: "copy", suggestChildren: false });
  store.liveCopiedCount.mockResolvedValue(1240);
  store.saveMode.mockResolvedValue({ outcome: "saved", removed: 1240 });
});

describe("/api/admin/church-records/mode", () => {
  it("doesn't exist without RECORDS_KEY_SECRET, or before the church connects", async () => {
    delete process.env.RECORDS_KEY_SECRET;
    expect((await GET()).status).toBe(404);
    process.env.RECORDS_KEY_SECRET = randomBytes(32).toString("base64");
    store.readConnection.mockResolvedValue(null);
    expect((await GET()).status).toBe(404);
    expect((await put({ mode: "live" })).status).toBe(404);
    expect(store.saveMode).not.toHaveBeenCalled();
  });

  it("turns away anyone but a church admin", async () => {
    requireOrgAdmin.mockResolvedValue({ ok: false, status: 403 });
    expect((await GET()).status).toBe(403);
    expect((await put({ mode: "live" })).status).toBe(403);
    expect(store.saveMode).not.toHaveBeenCalled();
  });

  it("shows the mode and how many details switching to live would remove", async () => {
    expect(await (await GET()).json()).toEqual({ mode: "copy", copiedCount: 1240 });
    expect(store.liveCopiedCount).toHaveBeenCalledWith("org-1");
  });

  it("saves the admin's own church's mode and says how many details it removed", async () => {
    const res = await put({ mode: "live" });
    expect(await res.json()).toEqual({ mode: "live", removed: 1240 });
    expect(store.saveMode).toHaveBeenCalledWith("org-1", "live", "admin-1");
  });

  it("refuses an unknown mode, and saves nothing while a refresh runs", async () => {
    expect((await put({ mode: "everything" })).status).toBe(400);
    expect(store.saveMode).not.toHaveBeenCalled();
    store.saveMode.mockResolvedValue({ outcome: "busy" });
    expect((await put({ mode: "copy" })).status).toBe(409);
  });
});
