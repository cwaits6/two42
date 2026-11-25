import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () =>
    Promise.resolve({
      auth: { getUser: () => Promise.resolve({ data: { user: { id: "leader" } } }) },
      rpc: (fn: string, args: unknown) => rpc(fn, args),
    }),
}));
vi.mock("@/lib/org", () => ({ resolveRequestOrgId: () => Promise.resolve("org-a") }));
const notifyTablesPublished = vi.fn();
vi.mock("@/lib/dinnerClub/notify", () => ({
  notifyTablesPublished: (...args: unknown[]) => notifyTablesPublished(...args),
}));
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));

const { POST } = await import("@/app/api/dinner-club/seasons/[seasonId]/publish/route");

const SEASON = "11111111-1111-4111-8111-111111111111";
const publish = (seasonId = SEASON) => POST(new Request("https://two42.example"), { params: Promise.resolve({ seasonId }) });

describe("POST /api/dinner-club/seasons/[seasonId]/publish", () => {
  beforeEach(() => {
    rpc.mockReset();
    notifyTablesPublished.mockReset();
  });

  it("answers someone who does not lead the group with a 404 and emails nobody", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "DC001", message: "no season" } });
    const res = await publish();
    expect(res.status).toBe(404);
    expect(notifyTablesPublished).not.toHaveBeenCalled();
  });

  it("refuses a draft the database finds wrong", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "DC002", message: "bad draft" } });
    expect((await publish()).status).toBe(400);
  });

  it("emails nobody when the season has ended", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "DC003", message: "not ready" } });
    expect((await publish()).status).toBe(409);
    expect(notifyTablesPublished).not.toHaveBeenCalled();
  });

  it("emails the people whose tables changed, in the caller's church, and reports the daily cap", async () => {
    rpc.mockResolvedValue({ data: [{ profile_id: "a" }, { profile_id: "b" }], error: null });
    notifyTablesPublished.mockResolvedValue({ sent: 0, failed: 0, capped: true });
    const res = await publish();
    expect(rpc).toHaveBeenCalledWith("dinner_tables_publish", { _season_id: SEASON });
    expect(notifyTablesPublished).toHaveBeenCalledWith("org-a", SEASON, ["a", "b"]);
    expect(await res.json()).toEqual({ changed: 2, sent: 0, capped: true, unsent: true });
  });

  it("still answers that the tables are published when the emails could not be sent, and says they were not", async () => {
    rpc.mockResolvedValue({ data: [{ profile_id: "a" }], error: null });
    notifyTablesPublished.mockRejectedValue(new Error("down"));
    const res = await publish();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ changed: 1, sent: 0, capped: false, unsent: true });
  });

  it("404s a malformed season id before any query", async () => {
    expect((await publish("nope")).status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });
});
