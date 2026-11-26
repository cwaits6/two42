import { beforeEach, describe, expect, it, vi } from "vitest";

type Result = { data: unknown; error: { code?: string; message: string } | null };

// Each read of the date's suppers takes the next result: before the move, then after it.
const reads: Result[] = [];
let update: Result = { data: [{ id: "date" }], error: null };
vi.mock("@/lib/supabase/server", () => ({
  createClient: () =>
    Promise.resolve({
      auth: { getUser: () => Promise.resolve({ data: { user: { id: "leader" } } }) },
      from: (table: string) =>
        table === "suppers"
          ? { select: () => ({ eq: () => Promise.resolve(reads.shift()) }) }
          : { update: () => ({ eq: () => ({ select: () => Promise.resolve(update) }) }) },
    }),
}));
vi.mock("@/lib/org", () => ({ resolveRequestOrgId: () => Promise.resolve("org-a") }));
const notifySuppersMoved = vi.fn();
vi.mock("@/lib/supperClub/notify", () => ({
  notifySuppersMoved: (...args: unknown[]) => notifySuppersMoved(...args),
}));
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));

const { POST } = await import("@/app/api/supper-club/rotation-dates/[dateId]/move/route");

const DATE = "22222222-2222-4222-8222-222222222222";
const NEW_TIME = "2031-02-08T18:00:00.000Z";
const move = () =>
  POST(new Request("https://two42.example", { method: "POST", body: JSON.stringify({ startsAt: NEW_TIME }) }), {
    params: Promise.resolve({ dateId: DATE }),
  });

const before = [
  { id: "moves", starts_at: "2031-02-01T18:00:00+00:00" },
  { id: "host-moved", starts_at: "2031-02-02T18:00:00+00:00" },
];
const after = [
  { id: "moves", starts_at: "2031-02-08T18:00:00+00:00" },
  { id: "host-moved", starts_at: "2031-02-02T18:00:00+00:00" },
];

describe("POST /api/supper-club/rotation-dates/[dateId]/move", () => {
  beforeEach(() => {
    reads.length = 0;
    update = { data: [{ id: DATE }], error: null };
    notifySuppersMoved.mockReset();
  });

  it("emails only the tables whose supper moved with the date, and says everyone heard", async () => {
    reads.push({ data: before, error: null }, { data: after, error: null });
    notifySuppersMoved.mockResolvedValue({ sent: 2, failed: 0, capped: false });
    const res = await move();
    expect(notifySuppersMoved).toHaveBeenCalledWith(
      "org-a",
      [{ supperId: "moves", oldStartsAt: "2031-02-01T18:00:00+00:00" }],
      "leader",
    );
    expect(await res.json()).toEqual({ sent: 2, capped: false, unsent: false });
  });

  it("says the table wasn't emailed when the moved suppers can't be read back", async () => {
    reads.push({ data: before, error: null }, { data: null, error: { message: "down" } });
    const res = await move();
    expect(res.status).toBe(200);
    expect(notifySuppersMoved).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({ sent: 0, capped: false, unsent: true });
  });

  it("says the table wasn't emailed when sending fails", async () => {
    reads.push({ data: before, error: null }, { data: after, error: null });
    notifySuppersMoved.mockRejectedValue(new Error("down"));
    const res = await move();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: 0, capped: false, unsent: true });
  });
});
