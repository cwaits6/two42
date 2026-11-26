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
            maybeSingle: () => Promise.resolve({ data: { id: DINNER, starts_at: "2031-02-01T18:00:00+00:00" }, error: null }),
          }),
        }),
        update: (values: Record<string, unknown>) => {
          updates.push(values);
          return {
            eq: () => ({
              select: () => Promise.resolve(refusal.code ? { data: null, error: refusal } : { data: [{ id: DINNER }], error: null }),
            }),
          };
        },
      }),
    }),
}));
vi.mock("@/lib/org", () => ({ resolveRequestOrgId: () => Promise.resolve("org-a") }));
const notifyDinnersMoved = vi.fn();
vi.mock("@/lib/dinnerClub/notify", () => ({
  notifyDinnersMoved: (...args: unknown[]) => notifyDinnersMoved(...args),
}));
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));

const { POST } = await import("@/app/api/dinner-club/dinners/[dinnerId]/move/route");

const DINNER = "33333333-3333-4333-8333-333333333333";
const move = () =>
  POST(
    new Request("https://two42.example", { method: "POST", body: JSON.stringify({ startsAt: "2031-02-08T18:00:00.000Z" }) }),
    { params: Promise.resolve({ dinnerId: DINNER }) },
  );

describe("POST /api/dinner-club/dinners/[dinnerId]/move", () => {
  beforeEach(() => {
    notifyDinnersMoved.mockReset();
    updates.length = 0;
    refusal.code = "";
  });

  it("asks the host again: a moved dinner clears that they can't host", async () => {
    notifyDinnersMoved.mockResolvedValue({ sent: 0, failed: 0, capped: false });
    await move();
    expect(updates).toEqual([{ starts_at: "2031-02-08T18:00:00.000Z", host_unavailable: false }]);
  });

  it("emails nobody when the season has ended", async () => {
    refusal.code = "DC003";
    const res = await move();
    expect(res.status).toBe(409);
    expect(notifyDinnersMoved).not.toHaveBeenCalled();
  });

  it("emails the table about the dinner it moved, and says everyone heard", async () => {
    notifyDinnersMoved.mockResolvedValue({ sent: 3, failed: 0, capped: false });
    const res = await move();
    expect(notifyDinnersMoved).toHaveBeenCalledWith(
      "org-a",
      [{ dinnerId: DINNER, oldStartsAt: "2031-02-01T18:00:00+00:00" }],
      "host",
    );
    expect(await res.json()).toEqual({ sent: 3, capped: false, unsent: false });
  });

  it("says the table wasn't emailed when sending fails", async () => {
    notifyDinnersMoved.mockRejectedValue(new Error("down"));
    const res = await move();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: 0, capped: false, unsent: true });
  });

  it("says some emails didn't go out when one failed", async () => {
    notifyDinnersMoved.mockResolvedValue({ sent: 2, failed: 1, capped: false });
    expect(await (await move()).json()).toEqual({ sent: 2, capped: false, unsent: true });
  });
});
