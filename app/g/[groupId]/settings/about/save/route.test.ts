import { beforeEach, describe, expect, it, vi } from "vitest";

const A = "11111111-1111-4111-8111-111111111111";
const LISTED = "22222222-2222-4222-8222-222222222222";
const NEW_MEMBER = "33333333-3333-4333-8333-333333333333";
const OUTSIDER = "44444444-4444-4444-8444-444444444444";
const ORG = "55555555-5555-4555-8555-555555555555";

let user: { id: string } | null;
let role: "leader" | "member";
let failing: string | null;
type Write = { table: string; op: string; rows?: unknown; filters: [string, unknown][] };
let writes: Write[];

/** Reads answer from the small fixtures above; writes are recorded and report one row per row sent. */
function fakeClient() {
  return {
    from(table: string) {
      const filters: [string, unknown][] = [];
      let write: Write | null = null;
      let rowsSent = 1;
      const chain = {
        select: () => chain,
        eq: (column: string, value: unknown) => (filters.push([column, value]), chain),
        in: (column: string, value: unknown) => (filters.push([column, value]), chain),
        delete: () => ((write = { table, op: "delete", filters }), chain),
        update: (rows: unknown) => ((write = { table, op: "update", rows, filters }), chain),
        upsert: (rows: unknown) => {
          write = { table, op: "upsert", rows, filters };
          rowsSent = Array.isArray(rows) ? rows.length : 1;
          return chain;
        },
        maybeSingle: async () => ({ data: { org_id: ORG }, error: null }),
        then(resolve: (value: unknown) => void) {
          if (write) writes.push(write);
          if (failing === table) return resolve({ data: null, error: { message: "boom" } });
          if (write) return resolve({ data: Array.from({ length: rowsSent }, () => ({})), error: null });
          if (table === "class_teachers") return resolve({ data: [{ profile_id: LISTED }], error: null });
          if (table === "group_members") {
            const wanted = filters.find(([c]) => c === "profile_id")?.[1] as string[];
            const members = [LISTED, NEW_MEMBER];
            return resolve({
              data: wanted.filter((id) => members.includes(id)).map((profile_id) => ({ profile_id })),
              error: null,
            });
          }
          return resolve({ data: [], error: null });
        },
      };
      return chain;
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fakeClient() }));
vi.mock("@/lib/supabase/current-user", () => ({ getOptionalUser: async () => user }));
vi.mock("@/lib/groups/server", () => ({
  getGroupMemberships: async () => [{ id: A, name: "Grace", color: null, role }],
}));
const ensureGroupCalendar = vi.fn();
vi.mock("@/lib/groups/calendar", () => ({
  ensureGroupCalendar: (...args: unknown[]) => ensureGroupCalendar(...args),
}));

const { POST } = await import("./route");

function save(body: unknown, groupId = A) {
  return POST(new Request("http://test/save", { method: "POST", body: JSON.stringify(body) }), {
    params: Promise.resolve({ groupId }),
  });
}

const entry = (profile_id: string) => ({ profile_id, title: "", bio: "" });

beforeEach(() => {
  user = { id: "viewer" };
  role = "leader";
  failing = null;
  writes = [];
  ensureGroupCalendar.mockReset();
  ensureGroupCalendar.mockResolvedValue("calendar-1");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST settings/about/save", () => {
  it("answers 401 signed out and 404 to a member who does not lead the group, writing nothing", async () => {
    role = "member";
    expect((await save({ summary: "[]" })).status).toBe(404);
    expect((await save({ summary: "[]" }, "not-a-uuid")).status).toBe(404);
    user = null;
    expect((await save({ summary: "[]" })).status).toBe(401);
    expect(writes).toEqual([]);
  });

  it("refuses malformed changes with 400 before any write", async () => {
    expect((await save({ color: "url(x)", summary: "[]" })).status).toBe(400);
    expect(writes).toEqual([]);
  });

  it("refuses someone outside the group, and applies nothing else from that Save", async () => {
    const res = await save({
      summary: "[]",
      color: "#B85C38",
      leaders: { list: [entry(LISTED), entry(OUTSIDER)], removed: [] },
    });
    expect(res.status).toBe(409);
    expect(writes).toEqual([]);
  });

  it("adds a member of the group, in page order, stamped with the group and the caller's org", async () => {
    const res = await save({ leaders: { list: [entry(NEW_MEMBER), entry(LISTED)], removed: [] } });
    expect(res.status).toBe(200);
    expect(writes).toHaveLength(1);
    expect(writes[0].rows).toEqual([
      { org_id: ORG, group_id: A, profile_id: NEW_MEMBER, title: "", bio: "", sort_order: 0 },
      { org_id: ORG, group_id: A, profile_id: LISTED, title: "", bio: "", sort_order: 1 },
    ]);
  });

  it("keeps an entry already on the list even if that person is no longer a member", async () => {
    // LISTED is the row the fake reports as already listed, so no membership read is asked about it.
    const res = await save({ leaders: { list: [{ ...entry(LISTED), title: "Host" }], removed: [] } });
    expect(res.status).toBe(200);
  });

  it("deletes only who was removed, scoped to this group and org", async () => {
    const res = await save({ leaders: { list: [], removed: [LISTED] } });
    expect(res.status).toBe(200);
    expect(writes).toEqual([
      {
        table: "class_teachers",
        op: "delete",
        filters: [
          ["org_id", ORG],
          ["group_id", A],
          ["profile_id", [LISTED]],
        ],
      },
    ]);
  });

  it("writes only the sections it was sent", async () => {
    await save({ videoCall: { url: "", time: "" } });
    expect(writes.map((w) => w.table)).toEqual(["group_settings"]);
    expect(writes[0].rows).toMatchObject({ weekly_zoom_url: null, zoom_meeting_time: null });
    expect(writes[0].rows).not.toHaveProperty("weekly_prayer_call_url");
    expect(writes[0].rows).not.toHaveProperty("calendar_meeting_details");
  });

  it("scopes the color write to the group's calendar and org", async () => {
    await save({ color: "#B85C38" });
    expect(ensureGroupCalendar).toHaveBeenCalledWith(expect.anything(), ORG, A, "Grace");
    expect(writes[0].filters).toEqual([
      ["id", "calendar-1"],
      ["org_id", ORG],
      ["group_id", A],
    ]);
  });

  it("answers 500 when a write fails", async () => {
    failing = "about_page";
    expect((await save({ summary: "[]" })).status).toBe(500);
  });

  it("answers 500 rather than guessing when the membership read fails", async () => {
    failing = "group_members";
    const res = await save({ leaders: { list: [entry(NEW_MEMBER)], removed: [] } });
    expect(res.status).toBe(500);
    expect(writes).toEqual([]);
  });
});
