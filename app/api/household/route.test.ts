// A household write that a policy filters out answers with no error and no
// row. The route must refuse it, or a cleared anniversary reads as saved.

import { beforeEach, describe, expect, it, vi } from "vitest";

const rows = { written: [] as { id: string }[] };
const update = vi.fn();

// PostgREST's answers for each way a caller can end the chain.
const resolved = <T>(value: T) => ({ then: (done: (v: T) => unknown) => Promise.resolve(value).then(done) });
const returning = () => ({
  ...resolved({ data: rows.written, error: null }),
  single: async () =>
    rows.written.length === 1
      ? { data: rows.written[0], error: null }
      : { data: null, error: { code: "PGRST116", message: "Cannot coerce the result to a single JSON object" } },
  maybeSingle: async () => ({ data: rows.written[0] ?? null, error: null }),
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    from: (table: string) =>
      table === "profiles"
        ? {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: { role: "member", family_id: "f1", setup_completed: true, relationship: "spouse" },
                }),
              }),
            }),
          }
        : {
            update: (values: unknown) => {
              update(values);
              return { eq: () => ({ ...resolved({ data: null, error: null }), select: returning }) };
            },
          },
  }),
}));

const { PATCH } = await import("./route");

const clearAnniversary = () =>
  PATCH(
    new Request("http://localhost/api/household", {
      method: "PATCH",
      body: JSON.stringify({ anniversary_month: "", anniversary_day: "", anniversary_year: "" }),
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("PATCH /api/household clearing the anniversary", () => {
  it("answers with the row it wrote", async () => {
    rows.written = [{ id: "f1" }];
    const res = await clearAnniversary();

    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ anniversary_month: null, anniversary_day: null, anniversary_year: null }),
    );
  });

  it("refuses a save that wrote no row", async () => {
    rows.written = [];
    const res = await clearAnniversary();

    expect(res.ok).toBe(false);
  });
});
