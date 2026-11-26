import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireOrgAdmin = vi.fn();
vi.mock("@/lib/members/access", () => ({ requireOrgAdmin: () => requireOrgAdmin() }));

const store = vi.hoisted(() => ({
  readConnection: vi.fn(),
  readFieldSettings: vi.fn(),
  readCopyStatus: vi.fn(),
  saveFieldSettings: vi.fn(),
}));
vi.mock("@/lib/integrations/records/store", () => store);

import { GET, PUT } from "./route";

const CONNECTION = { provider: "rock", baseUrl: "https://rock.example.org", keyHint: "9012", connectedAt: "2026-11-20T00:00:00Z" };

function put(body: unknown) {
  return PUT(new Request("http://test/api/admin/church-records/copy", { method: "PUT", body: JSON.stringify(body) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.RECORDS_KEY_SECRET = randomBytes(32).toString("base64");
  requireOrgAdmin.mockResolvedValue({ ok: true, orgId: "org-1", user: { id: "admin-1" } });
  store.readConnection.mockResolvedValue(CONNECTION);
  store.readFieldSettings.mockResolvedValue({ name: "locked", phone_mobile: "member" });
  store.saveFieldSettings.mockResolvedValue("saved");
  store.readCopyStatus.mockResolvedValue({
    lastRefreshedAt: "2026-11-26T03:00:00Z",
    pending: 3,
    review: [{ profileId: "p-1", personId: "100", name: "Isaac Seedly", reason: "inactive", since: "2026-11-25T03:00:00Z" }],
  });
});

describe("/api/admin/church-records/copy", () => {
  it("doesn't exist without RECORDS_KEY_SECRET, or before the church connects", async () => {
    delete process.env.RECORDS_KEY_SECRET;
    expect((await GET()).status).toBe(404);
    process.env.RECORDS_KEY_SECRET = randomBytes(32).toString("base64");
    store.readConnection.mockResolvedValue(null);
    expect((await GET()).status).toBe(404);
    expect((await put({ fields: {} })).status).toBe(404);
    expect(store.saveFieldSettings).not.toHaveBeenCalled();
  });

  it("turns away anyone but a church admin", async () => {
    requireOrgAdmin.mockResolvedValue({ ok: false, status: 403 });
    expect((await GET()).status).toBe(403);
    expect((await put({ fields: { phone_mobile: "member" } })).status).toBe(403);
    expect(store.saveFieldSettings).not.toHaveBeenCalled();
  });

  it("shows the settings, the last refresh and the people to review, with where to open each", async () => {
    const res = await GET();
    expect(await res.json()).toEqual({
      fields: { name: "locked", phone_mobile: "member" },
      lastRefreshedAt: "2026-11-26T03:00:00Z",
      pending: 3,
      review: [
        {
          profileId: "p-1",
          name: "Isaac Seedly",
          reason: "inactive",
          since: "2026-11-25T03:00:00Z",
          url: "https://rock.example.org/Person/100",
        },
      ],
    });
    expect(store.readCopyStatus).toHaveBeenCalledWith("org-1");
  });

  it("counts nobody as waiting while every field is not from the records", async () => {
    store.readFieldSettings.mockResolvedValue({});
    expect((await (await GET()).json()).pending).toBe(0);
  });

  it("saves the settings for the admin's own church", async () => {
    const res = await put({ fields: { name: "locked", phone_mobile: "member", photo: "member" } });
    expect(res.status).toBe(200);
    expect(store.saveFieldSettings).toHaveBeenCalledWith(
      "org-1",
      { name: "locked", phone_mobile: "member", photo: "member" },
      "admin-1",
    );
    // Answered from what was saved, so a failed read can't report a committed save as failed.
    store.readFieldSettings.mockClear();
    const again = await put({ fields: { name: "locked", phone_mobile: "member" } });
    expect(await again.json()).toEqual({ fields: { name: "locked", phone_mobile: "member" } });
    expect(store.readFieldSettings).not.toHaveBeenCalled();
  });

  it("answers 409 while a refresh is running, which saved nothing", async () => {
    store.saveFieldSettings.mockResolvedValue("busy");
    const res = await put({ fields: { name: "locked" } });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/refresh is running/);
  });

  it.each([
    [{ phone_mobile: "locked" }],
    [{ birthday: "locked" }],
    [{ photo: "locked" }],
    [{ email: "member" }],
    [{ address: "member" }],
    [{ name: "always" }],
    [["name"]],
    [null],
  ])("refuses %j", async (fields) => {
    expect((await put({ fields })).status).toBe(400);
    expect(store.saveFieldSettings).not.toHaveBeenCalled();
  });
});
