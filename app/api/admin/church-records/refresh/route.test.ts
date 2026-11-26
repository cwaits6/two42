import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireOrgAdmin = vi.fn();
vi.mock("@/lib/members/access", () => ({ requireOrgAdmin: () => requireOrgAdmin() }));

const store = vi.hoisted(() => ({ loadCredentials: vi.fn() }));
vi.mock("@/lib/integrations/records/store", () => store);

const refresh = vi.hoisted(() => ({ refreshNow: vi.fn() }));
vi.mock("@/lib/integrations/records/refresh", () => refresh);

import { RecordsCryptoError } from "@/lib/integrations/records/crypto";
import { RecordsError } from "@/lib/integrations/records/errors";
import { rockProvider } from "@/lib/integrations/rock/provider";
import { POST } from "./route";

const LOADED = {
  provider: rockProvider,
  creds: { baseUrl: "https://rock.example.org", key: "secret-key" },
  connectionId: "conn-1",
};
const DONE = {
  status: "done",
  copied: 2,
  pending: 0,
  review: 1,
  photosSkipped: 0,
  failed: 0,
  stoppedAtBudget: false,
  householdsCopied: 0,
  householdsUnavailable: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.RECORDS_KEY_SECRET = randomBytes(32).toString("base64");
  requireOrgAdmin.mockResolvedValue({ ok: true, orgId: "org-1", user: { id: "admin-1" } });
  store.loadCredentials.mockResolvedValue(LOADED);
  refresh.refreshNow.mockResolvedValue(DONE);
});

describe("POST /api/admin/church-records/refresh", () => {
  it("doesn't exist without RECORDS_KEY_SECRET, before any check", async () => {
    delete process.env.RECORDS_KEY_SECRET;
    expect((await POST()).status).toBe(404);
    expect(requireOrgAdmin).not.toHaveBeenCalled();
  });

  it("turns away anyone but a church admin", async () => {
    requireOrgAdmin.mockResolvedValue({ ok: false, status: 403 });
    expect((await POST()).status).toBe(403);
    expect(refresh.refreshNow).not.toHaveBeenCalled();
  });

  it("refreshes the admin's own church and answers with counts only", async () => {
    const res = await POST();
    expect(await res.json()).toEqual({ copied: 2, pending: 0, review: 1, photosSkipped: 0, failed: 0 });
    expect(refresh.refreshNow).toHaveBeenCalledWith("org-1", LOADED);
  });

  it("is not there for a church with no connection, or a provider that offers no copying", async () => {
    store.loadCredentials.mockResolvedValue(null);
    expect((await POST()).status).toBe(404);
    store.loadCredentials.mockResolvedValue(LOADED);
    refresh.refreshNow.mockResolvedValue(null);
    expect((await POST()).status).toBe(404);
  });

  it("asks for a reconnect only when the saved key won't open", async () => {
    store.loadCredentials.mockRejectedValue(new RecordsCryptoError());
    let res = await POST();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("The saved key can't be opened. Choose Change key and enter it again; your links stay.");

    store.loadCredentials.mockRejectedValue(new Error("read failed"));
    res = await POST();
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Couldn't load the connection.");
    expect(refresh.refreshNow).not.toHaveBeenCalled();
  });

  it("says when a refresh is already running", async () => {
    refresh.refreshNow.mockResolvedValue({ ...DONE, status: "busy" });
    const res = await POST();
    expect(res.status).toBe(409);
  });

  it("reports a records failure in the admin's words, never the records' own response", async () => {
    refresh.refreshNow.mockRejectedValue(new RecordsError("unauthorized", 401));
    const res = await POST();
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/Rock RMS didn't accept the key/);
  });
});
