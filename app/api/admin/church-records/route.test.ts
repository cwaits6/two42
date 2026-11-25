import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireOrgAdmin = vi.fn();
vi.mock("@/lib/members/access", () => ({ requireOrgAdmin: () => requireOrgAdmin() }));

const store = vi.hoisted(() => ({
  readConnection: vi.fn(),
  saveConnection: vi.fn(),
  deleteConnection: vi.fn(),
}));
vi.mock("@/lib/integrations/records/store", () => store);

const checkConnection = vi.fn();
vi.mock("@/lib/integrations/rock/client", async (original) => ({
  ...(await original<typeof import("@/lib/integrations/rock/client")>()),
  checkConnection: (...args: unknown[]) => checkConnection(...args),
}));

import { RecordsError } from "@/lib/integrations/records/errors";
import { openKey } from "@/lib/integrations/records/crypto";
import { DELETE, GET, PUT } from "./route";

const SECRET = randomBytes(32);
const SUMMARY = { provider: "rock", baseUrl: "https://rock.example.org", keyHint: "9012", connectedAt: "2026-11-20T00:00:00Z" };

function put(body: unknown) {
  return PUT(new Request("http://test/api/admin/church-records", { method: "PUT", body: JSON.stringify(body) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.RECORDS_KEY_SECRET = SECRET.toString("base64");
  requireOrgAdmin.mockResolvedValue({ ok: true, orgId: "org-1", user: { id: "admin-1" } });
  store.readConnection.mockResolvedValue(SUMMARY);
  checkConnection.mockResolvedValue(undefined);
});

describe("/api/admin/church-records", () => {
  it("doesn't exist without RECORDS_KEY_SECRET, before any check", async () => {
    delete process.env.RECORDS_KEY_SECRET;
    expect((await GET()).status).toBe(404);
    expect((await put({})).status).toBe(404);
    expect((await DELETE()).status).toBe(404);
    expect(requireOrgAdmin).not.toHaveBeenCalled();
  });

  it("turns away anyone but a church admin", async () => {
    requireOrgAdmin.mockResolvedValue({ ok: false, status: 403 });
    expect((await GET()).status).toBe(403);
    expect((await put({ address: "rock.example.org", key: "abcdefgh1234" })).status).toBe(403);
    expect(store.saveConnection).not.toHaveBeenCalled();
  });

  it("shows the connection without the key", async () => {
    const res = await GET();
    expect(await res.json()).toEqual({ connection: { ...SUMMARY, providerLabel: "Rock RMS" } });
    expect(store.readConnection).toHaveBeenCalledWith("org-1");
  });

  it("checks the key with Rock, then stores it sealed for this church and provider with only its last four characters shown", async () => {
    const res = await put({ address: "rock.example.org/page/1", key: "  AbCdEfGhIjKl9012 " });
    expect(res.status).toBe(200);
    expect(checkConnection).toHaveBeenCalledWith({ baseUrl: "https://rock.example.org", key: "AbCdEfGhIjKl9012" });
    const [orgId, row] = store.saveConnection.mock.calls[0];
    expect(orgId).toBe("org-1");
    expect(row).toMatchObject({ provider: "rock", baseUrl: "https://rock.example.org", keyHint: "9012", connectedBy: "admin-1" });
    expect(row.keyCiphertext).not.toContain("AbCdEfGh");
    expect(openKey(SECRET, "org-1", "rock", row.keyCiphertext)).toBe("AbCdEfGhIjKl9012");
    expect(JSON.stringify(await res.json())).not.toContain("AbCdEfGh");
  });

  it("refuses a private address without calling it", async () => {
    const res = await put({ address: "https://169.254.169.254", key: "abcdefgh1234" });
    expect(res.status).toBe(400);
    expect(checkConnection).not.toHaveBeenCalled();
  });

  it("saves nothing when Rock refuses the key", async () => {
    checkConnection.mockRejectedValue(new RecordsError("unauthorized", 401));
    const res = await put({ address: "rock.example.org", key: "abcdefgh1234" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/didn't accept the key/);
    expect(store.saveConnection).not.toHaveBeenCalled();
  });

  it("refuses a provider two42 doesn't know", async () => {
    const res = await put({ provider: "other", address: "rock.example.org", key: "abcdefgh1234" });
    expect(res.status).toBe(400);
    expect(checkConnection).not.toHaveBeenCalled();
  });

  it("disconnects this church only", async () => {
    store.deleteConnection.mockResolvedValue(true);
    expect((await DELETE()).status).toBe(200);
    expect(store.deleteConnection).toHaveBeenCalledWith("org-1");
  });
});
