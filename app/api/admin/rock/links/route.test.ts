import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const PROFILE_A = "11111111-1111-4111-8111-111111111111";
const PROFILE_B = "22222222-2222-4222-8222-222222222222";

const profiles = [
  { id: PROFILE_A, first_name: "Margaret", preferred_name: null, last_name: "Obrien", birth_month: 4, birth_day: 12, birth_year: null },
  { id: PROFILE_B, first_name: "Tom", preferred_name: null, last_name: "Obrien", birth_month: null, birth_day: null, birth_year: null },
];
const emails = [
  { profile_id: PROFILE_A, email: "obriens@example.org" },
  { profile_id: PROFILE_B, email: "obriens@example.org" },
];

const filters: unknown[][] = [];
function requestClient() {
  const chain = {
    select: () => chain,
    eq: (...args: unknown[]) => (filters.push(args), chain),
    neq: async () => ({ data: profiles, error: null }),
  };
  return { from: () => chain, rpc: async () => ({ data: emails, error: null }) };
}

const requireOrgAdmin = vi.fn();
vi.mock("@/lib/members/access", () => ({ requireOrgAdmin: () => requireOrgAdmin() }));

const store = vi.hoisted(() => ({ loadCredentials: vi.fn(), readLinks: vi.fn(), insertLinks: vi.fn() }));
vi.mock("@/lib/integrations/rock/store", () => store);

const rock = vi.hoisted(() => ({ definedValueIds: vi.fn(), peopleByLastName: vi.fn(), peopleByIds: vi.fn() }));
vi.mock("@/lib/integrations/rock/client", async (original) => ({
  ...(await original<typeof import("@/lib/integrations/rock/client")>()),
  ...rock,
}));

import { GET, POST } from "./route";

const IDS = { recordTypePerson: 1, recordStatusInactive: 4 };
const peggy = {
  id: 100, firstName: "Margaret", nickName: "Peggy", lastName: "O'Brien", email: "obriens@example.org",
  birthMonth: 4, birthDay: 12, birthYear: 1961, recordTypeValueId: 1, recordStatusValueId: 3, isDeceased: false,
};
const tom = { ...peggy, id: 101, firstName: "Thomas", nickName: "Tom", email: "tom@example.org", birthMonth: null, birthDay: null };

function post(body: unknown) {
  return POST(new Request("http://test/api/admin/rock/links", { method: "POST", body: JSON.stringify(body) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  filters.length = 0;
  process.env.ROCK_KEY_SECRET = randomBytes(32).toString("base64");
  requireOrgAdmin.mockResolvedValue({ ok: true, orgId: "org-1", user: { id: "admin-1" }, supabase: requestClient() });
  store.loadCredentials.mockResolvedValue({ baseUrl: "https://rock.example.org", restKey: "k" });
  store.readLinks.mockResolvedValue([]);
  store.insertLinks.mockResolvedValue("inserted");
  rock.definedValueIds.mockResolvedValue(IDS);
  rock.peopleByLastName.mockResolvedValue([peggy, tom]);
  rock.peopleByIds.mockImplementation(async (_c: unknown, ids: number[]) => [peggy, tom].filter((p) => ids.includes(p.id)));
});

describe("GET /api/admin/rock/links", () => {
  it("reads this church's people and shows Rock names and what matched, never Rock's values", async () => {
    const res = await GET();
    const body = await res.json();
    expect(filters).toContainEqual(["org_id", "org-1"]);
    expect(body.suggestions).toEqual([
      expect.objectContaining({ profileId: PROFILE_A, rockPersonId: 100, rockName: "Peggy O'Brien", confirmableInBulk: true }),
      expect.objectContaining({ profileId: PROFILE_B, rockPersonId: 101, rockName: "Tom O'Brien" }),
    ]);
    const text = JSON.stringify(body);
    expect(text).not.toContain("obriens@example.org");
    expect(text).not.toContain("1961");
  });

  it("asks to connect first when there is no connection", async () => {
    store.loadCredentials.mockResolvedValue(null);
    expect((await GET()).status).toBe(409);
  });
});

describe("POST /api/admin/rock/links", () => {
  it("links a pair after checking it with Rock again", async () => {
    const res = await post({ links: [{ profileId: PROFILE_A, rockPersonId: 100 }] });
    expect(res.status).toBe(200);
    expect(store.insertLinks).toHaveBeenCalledWith("org-1", "admin-1", [{ profileId: PROFILE_A, rockPersonId: 100 }]);
  });

  it("refuses a pair whose names don't agree, as with a spouse who shares the email", async () => {
    const res = await post({ links: [{ profileId: PROFILE_B, rockPersonId: 100 }] });
    expect(res.status).toBe(409);
    expect(store.insertLinks).not.toHaveBeenCalled();
  });

  it("refuses a name-only match in a group of links", async () => {
    const res = await post({
      links: [
        { profileId: PROFILE_A, rockPersonId: 100 },
        { profileId: PROFILE_B, rockPersonId: 101 },
      ],
    });
    expect(res.status).toBe(409);
    expect(store.insertLinks).not.toHaveBeenCalled();
  });

  it("refuses a profile outside the church", async () => {
    const res = await post({ links: [{ profileId: "33333333-3333-4333-8333-333333333333", rockPersonId: 100 }] });
    expect(res.status).toBe(409);
  });

  it("refuses malformed or repeated pairs", async () => {
    expect((await post({ links: [] })).status).toBe(400);
    expect((await post({ links: [{ profileId: "x", rockPersonId: 1 }] })).status).toBe(400);
    expect(
      (await post({ links: [{ profileId: PROFILE_A, rockPersonId: 100 }, { profileId: PROFILE_A, rockPersonId: 101 }] })).status,
    ).toBe(400);
  });

  it("reports an existing link as a conflict", async () => {
    store.insertLinks.mockResolvedValue("conflict");
    expect((await post({ links: [{ profileId: PROFILE_A, rockPersonId: 100 }] })).status).toBe(409);
  });
});
