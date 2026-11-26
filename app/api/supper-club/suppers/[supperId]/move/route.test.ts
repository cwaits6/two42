import { beforeEach, describe, expect, it, vi } from "vitest";

const updates = vi.hoisted(() => [] as Record<string, unknown>[]);
const refusal = vi.hoisted(() => ({ code: "" as string, message: "refused" }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () =>
    Promise.resolve({
      auth: { getUser: () => Promise.resolve({ data: { user: { id: "host" } } }) },
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: { id: SUPPER, starts_at: "2031-02-01T18:00:00+00:00" }, error: null }),
          }),
        }),
        update: (values: Record<string, unknown>) => {
          updates.push(values);
          return {
            eq: () => ({
              select: () => Promise.resolve(refusal.code ? { data: null, error: refusal } : { data: [{ id: SUPPER }], error: null }),
            }),
          };
        },
      }),
    }),
}));
vi.mock("@/lib/org", () => ({ resolveRequestOrgId: () => Promise.resolve("org-a") }));
const notifySuppersMoved = vi.fn();
vi.mock("@/lib/supperClub/notify", () => ({
  notifySuppersMoved: (...args: unknown[]) => notifySuppersMoved(...args),
}));
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));

const { POST } = await import("@/app/api/supper-club/suppers/[supperId]/move/route");

const SUPPER = "33333333-3333-4333-8333-333333333333";
const move = (startsAt = "2031-02-08T18:00:00.000Z") =>
  POST(
    new Request("https://two42.example", { method: "POST", body: JSON.stringify({ startsAt }) }),
    { params: Promise.resolve({ supperId: SUPPER }) },
  );

describe("POST /api/supper-club/suppers/[supperId]/move", () => {
  beforeEach(() => {
    notifySuppersMoved.mockReset();
    updates.length = 0;
    refusal.code = "";
  });

  it("asks the host again: a moved supper clears that they can't host", async () => {
    notifySuppersMoved.mockResolvedValue({ sent: 0, failed: 0, capped: false });
    await move();
    expect(updates).toEqual([{ starts_at: "2031-02-08T18:00:00.000Z", host_unavailable: false }]);
  });

  it("emails nobody when the rotation has ended", async () => {
    refusal.code = "SC003";
    const res = await move();
    expect(res.status).toBe(409);
    expect(notifySuppersMoved).not.toHaveBeenCalled();
  });

  it("emails the table about the supper it moved, and says everyone heard", async () => {
    notifySuppersMoved.mockResolvedValue({ sent: 3, failed: 0, capped: false });
    const res = await move();
    expect(notifySuppersMoved).toHaveBeenCalledWith(
      "org-a",
      [{ supperId: SUPPER, oldStartsAt: "2031-02-01T18:00:00+00:00" }],
      "host",
    );
    expect(await res.json()).toEqual({ sent: 3, capped: false, unsent: false });
  });

  it("says the table wasn't emailed when sending fails", async () => {
    notifySuppersMoved.mockRejectedValue(new Error("down"));
    const res = await move();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: 0, capped: false, unsent: true });
  });

  it("says some emails didn't go out when one failed", async () => {
    notifySuppersMoved.mockResolvedValue({ sent: 2, failed: 1, capped: false });
    expect(await (await move()).json()).toEqual({ sent: 2, capped: false, unsent: true });
  });

  it("writes nothing and emails nobody when the start is unchanged", async () => {
    const res = await move("2031-02-01T18:00:00.000Z");
    expect(updates).toEqual([]);
    expect(notifySuppersMoved).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({ sent: 0, capped: false, unsent: false });
  });
});
