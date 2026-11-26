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
vi.mock("@/lib/supperClub/notify", () => ({
  notifyTablesPublished: (...args: unknown[]) => notifyTablesPublished(...args),
}));
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));

const { POST } = await import("@/app/api/supper-club/rotations/[rotationId]/publish/route");

const ROTATION = "11111111-1111-4111-8111-111111111111";
const publish = (rotationId = ROTATION) => POST(new Request("https://two42.example"), { params: Promise.resolve({ rotationId }) });

describe("POST /api/supper-club/rotations/[rotationId]/publish", () => {
  beforeEach(() => {
    rpc.mockReset();
    notifyTablesPublished.mockReset();
  });

  it("answers someone who does not lead the group with a 404 and emails nobody", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "SC001", message: "no rotation" } });
    const res = await publish();
    expect(res.status).toBe(404);
    expect(notifyTablesPublished).not.toHaveBeenCalled();
  });

  it("refuses a draft the database finds wrong", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "SC002", message: "bad draft" } });
    expect((await publish()).status).toBe(400);
  });

  it("emails nobody when the rotation has ended", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "SC003", message: "not ready" } });
    expect((await publish()).status).toBe(409);
    expect(notifyTablesPublished).not.toHaveBeenCalled();
  });

  it("emails the people whose tables changed, in the caller's church, and reports the daily cap", async () => {
    rpc.mockResolvedValue({ data: [{ profile_id: "a" }, { profile_id: "b" }], error: null });
    notifyTablesPublished.mockResolvedValue({ sent: 0, failed: 0, capped: true });
    const res = await publish();
    expect(rpc).toHaveBeenCalledWith("supper_tables_publish", { _rotation_id: ROTATION });
    expect(notifyTablesPublished).toHaveBeenCalledWith("org-a", ROTATION, ["a", "b"]);
    expect(await res.json()).toEqual({ changed: 2, sent: 0, capped: true, unsent: true });
  });

  it("still answers that the tables are published when the emails could not be sent, and says they were not", async () => {
    rpc.mockResolvedValue({ data: [{ profile_id: "a" }], error: null });
    notifyTablesPublished.mockRejectedValue(new Error("down"));
    const res = await publish();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ changed: 1, sent: 0, capped: false, unsent: true });
  });

  it("404s a malformed rotation id before any query", async () => {
    expect((await publish("nope")).status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });
});
