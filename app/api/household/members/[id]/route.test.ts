// A failed save or removal of a household member answers with fixed copy; the
// database's own text, which names tables, columns and policies, stays out.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectSchemaHidden, fakeQueryClient, SCHEMA_REVEALING_ERROR, type QueryAnswer } from "@/lib/supabase/testing";

const db: { answers: Record<string, QueryAnswer[]>; updates: unknown[] } = { answers: {}, updates: [] };
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    const client = fakeQueryClient(db.answers);
    return {
      ...client,
      from(table: string) {
        const query = client.from(table) as object;
        return new Proxy(query, {
          get(target, prop) {
            if (prop !== "update") return Reflect.get(target, prop);
            return (values: unknown) => {
              db.updates.push(values);
              return query;
            };
          },
        });
      },
    };
  },
}));

const failed = { data: null, error: SCHEMA_REVEALING_ERROR };
const saved = { data: { id: "fm-1" }, error: null };
const primary = { data: { role: "member", family_id: "fam-1", setup_completed: true, relationship: "primary" }, error: null };
let log: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  db.updates = [];
  vi.restoreAllMocks();
  log = vi.spyOn(console, "log").mockImplementation(() => {});
});

const { PATCH, DELETE } = await import("./route");

const own = { data: { family_id: "fam-1" }, error: null };
const params = { params: Promise.resolve({ id: "fm-1" }) };

describe("/api/household/members/[id] when the database refuses", () => {
  it("PATCH answers 500 with fixed copy", async () => {
    db.answers = { profiles: [primary], family_members: [own, failed] };
    const req = new Request("http://localhost/api/household/members/fm-1", {
      method: "PATCH",
      body: JSON.stringify({ first_name: "Ruth" }),
    });
    await expectSchemaHidden(await PATCH(req, params), log, {
      status: 500,
      error: "Couldn't save their details. Try again.",
      what: "household/members PATCH error",
      route: "/api/household/members/[id]",
    });
  });

  it("DELETE answers 500 with fixed copy", async () => {
    db.answers = { profiles: [primary], family_members: [own, failed] };
    const req = new Request("http://localhost/api/household/members/fm-1", { method: "DELETE" });
    await expectSchemaHidden(await DELETE(req, params), log, {
      status: 500,
      error: "Couldn't remove them from your household. Try again.",
      what: "household/members DELETE error",
      route: "/api/household/members/[id]",
    });
  });
});

describe("/api/household/members/[id] names", () => {
  const patch = (body: unknown) =>
    PATCH(new Request("http://localhost/api/household/members/fm-1", { method: "PATCH", body: JSON.stringify(body) }), params);

  it("saves names capitalized", async () => {
    db.answers = { profiles: [primary], family_members: [own, saved] };
    const res = await patch({ first_name: "john", last_name: "MCDONALD" });

    expect(res.status).toBe(200);
    expect(db.updates).toEqual([{ first_name: "John", last_name: "McDonald" }]);
  });

  it("refuses an empty first name on its field and saves nothing", async () => {
    db.answers = { profiles: [primary], family_members: [own, saved] };
    const res = await patch({ first_name: "  " });

    expect(res.status).toBe(400);
    expect((await res.json()).fieldErrors).toEqual({ first_name: "Enter a first name." });
    expect(db.updates).toEqual([]);
  });
});
