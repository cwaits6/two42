import { beforeEach, describe, expect, it, vi } from "vitest";

type Result = { data: unknown; error: { code?: string; message: string } | null };

const order: string[] = [];
let deleted: Result = { data: [{ id: "date" }], error: null };
vi.mock("@/lib/supabase/server", () => ({
  createClient: () =>
    Promise.resolve({
      auth: { getUser: () => Promise.resolve({ data: { user: { id: "leader" } } }) },
      from: () => ({
        delete: () => ({
          eq: () => ({
            select: () => {
              order.push("delete");
              return Promise.resolve(deleted);
            },
          }),
        }),
      }),
    }),
}));
vi.mock("@/lib/org", () => ({ resolveRequestOrgId: () => Promise.resolve("org-a") }));
const prepare = vi.fn();
vi.mock("@/lib/supperClub/notify", () => ({
  prepareDateDeletedEmails: (...args: unknown[]) => prepare(...args),
}));
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));

const { DELETE } = await import("@/app/api/supper-club/rotation-dates/[dateId]/route");

const DATE = "22222222-2222-4222-8222-222222222222";
const remove = () => DELETE(new Request("https://two42.example", { method: "DELETE" }), { params: Promise.resolve({ dateId: DATE }) });

describe("DELETE /api/supper-club/rotation-dates/[dateId]", () => {
  beforeEach(() => {
    order.length = 0;
    deleted = { data: [{ id: DATE }], error: null };
    prepare.mockReset();
  });

  it("reads who to email before the delete, sends after it, and says everyone heard", async () => {
    const deliver = vi.fn(() => {
      order.push("send");
      return Promise.resolve({ sent: 3, failed: 0, capped: false });
    });
    prepare.mockImplementation(() => {
      order.push("prepare");
      return Promise.resolve(deliver);
    });
    const res = await remove();
    expect(prepare).toHaveBeenCalledWith("org-a", DATE, "leader");
    expect(order).toEqual(["prepare", "delete", "send"]);
    expect(await res.json()).toEqual({ sent: 3, capped: false, unsent: false });
  });

  it("sends nothing when the delete is refused because a supper has happened", async () => {
    const deliver = vi.fn();
    prepare.mockResolvedValue(deliver);
    deleted = { data: null, error: { code: "SC005", message: "stays" } };
    const res = await remove();
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "A date whose suppers have happened stays." });
    expect(deliver).not.toHaveBeenCalled();
  });

  it("sends nothing when row security deleted nothing", async () => {
    const deliver = vi.fn();
    prepare.mockResolvedValue(deliver);
    deleted = { data: [], error: null };
    expect((await remove()).status).toBe(404);
    expect(deliver).not.toHaveBeenCalled();
  });

  it("still deletes, and says the tables weren't emailed, when the recipients can't be read", async () => {
    prepare.mockRejectedValue(new Error("down"));
    const res = await remove();
    expect(order).toEqual(["delete"]);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: 0, capped: false, unsent: true });
  });

  it("says the tables weren't emailed when sending fails", async () => {
    prepare.mockResolvedValue(() => Promise.reject(new Error("down")));
    const res = await remove();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: 0, capped: false, unsent: true });
  });
});
