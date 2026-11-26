import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const PROFILE_A = "11111111-1111-4111-8111-111111111111";
const PROFILE_B = "22222222-2222-4222-8222-222222222222";
const PROFILE_C = "44444444-4444-4444-8444-444444444444";
const CONNECTION = "55555555-5555-4555-8555-555555555555";

const profiles: Record<string, unknown>[] = [
  { id: PROFILE_A, first_name: "Margaret", preferred_name: null, last_name: "Obrien", birth_month: 4, birth_day: 12, birth_year: null },
  { id: PROFILE_B, first_name: "Tom", preferred_name: null, last_name: "Obrien", birth_month: null, birth_day: null, birth_year: null },
];
const emails: { profile_id: string; email: string }[] = [
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
vi.mock("@/lib/integrations/records/store", () => store);

const rock = vi.hoisted(() => ({ definedValueIds: vi.fn(), peopleByLastName: vi.fn(), peopleByIds: vi.fn() }));
vi.mock("@/lib/integrations/rock/client", async (original) => ({
  ...(await original<typeof import("@/lib/integrations/rock/client")>()),
  ...rock,
}));

import { RecordsCryptoError } from "@/lib/integrations/records/crypto";
import { rockProvider } from "@/lib/integrations/rock/provider";
import { GET, POST } from "./route";

const IDS = { recordTypePerson: 1, recordStatusInactive: 4 };
const peggy = {
  id: 100, firstName: "Margaret", nickName: "Peggy", lastName: "O'Brien", email: "obriens@example.org",
  birthMonth: 4, birthDay: 12, birthYear: 1961, recordTypeValueId: 1, recordStatusValueId: 3, isDeceased: false,
};
const tom = { ...peggy, id: 101, firstName: "Thomas", nickName: "Tom", email: "tom@example.org", birthMonth: null, birthDay: null };

function post(body: unknown) {
  return POST(new Request("http://test/api/admin/church-records/links", { method: "POST", body: JSON.stringify(body) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  filters.length = 0;
  process.env.RECORDS_KEY_SECRET = randomBytes(32).toString("base64");
  requireOrgAdmin.mockResolvedValue({ ok: true, orgId: "org-1", user: { id: "admin-1" }, supabase: requestClient() });
  store.loadCredentials.mockResolvedValue({
    provider: rockProvider,
    creds: { baseUrl: "https://rock.example.org", key: "k" },
    connectionId: CONNECTION,
  });
  store.readLinks.mockResolvedValue([]);
  store.insertLinks.mockResolvedValue("inserted");
  rock.definedValueIds.mockResolvedValue(IDS);
  rock.peopleByLastName.mockResolvedValue({ people: [peggy, tom], truncated: [] });
  rock.peopleByIds.mockImplementation(async (_c: unknown, ids: number[]) => [peggy, tom].filter((p) => ids.includes(p.id)));
});

describe("GET /api/admin/church-records/links", () => {
  it("reads this church's people and shows names from the records and what matched, never their values", async () => {
    const res = await GET();
    const body = await res.json();
    expect(filters).toContainEqual(["org_id", "org-1"]);
    expect(body.suggestions).toEqual([
      expect.objectContaining({ profileId: PROFILE_A, personId: "100", personName: "Peggy O'Brien", confirmableInBulk: true }),
      expect.objectContaining({ profileId: PROFILE_B, personId: "101", personName: "Tom O'Brien" }),
    ]);
    expect(body.suggestions[0].personUrl).toBe("https://rock.example.org/Person/100");
    expect(body.unmatched).toEqual([]);
    const text = JSON.stringify(body);
    expect(text).not.toContain("obriens@example.org");
    expect(text).not.toContain("1961");
  });

  it("gives each linked person a link to open them in Rock", async () => {
    store.readLinks.mockResolvedValue([{ profileId: PROFILE_A, personId: "100", linkedAt: "2026-11-20T00:00:00Z" }]);
    const body = await (await GET()).json();
    expect(body.linked).toEqual([
      expect.objectContaining({ profileId: PROFILE_A, personUrl: "https://rock.example.org/Person/100" }),
    ]);
  });

  it("lists by two42 name the people with no suggestion", async () => {
    rock.peopleByLastName.mockResolvedValue({ people: [peggy], truncated: [] });
    const body = await (await GET()).json();
    expect(body.unmatched).toEqual([{ profileId: PROFILE_B, name: "Tom Obrien" }]);
  });

  it("asks to connect first when there is no connection", async () => {
    store.loadCredentials.mockResolvedValue(null);
    expect((await GET()).status).toBe(409);
  });

  it("points to Change key, with a status the page shows, when the saved key won't open", async () => {
    store.loadCredentials.mockRejectedValue(new RecordsCryptoError());
    for (const res of [await GET(), await post({ links: [{ profileId: PROFILE_A, personId: "100" }] })]) {
      expect(res.status).toBe(409);
      expect((await res.json()).error).toMatch(/Choose Change key/);
    }
  });
});

describe("POST /api/admin/church-records/links", () => {
  it("links a pair after checking it with the records again", async () => {
    const res = await post({ links: [{ profileId: PROFILE_A, personId: "100" }] });
    expect(res.status).toBe(200);
    expect(store.insertLinks).toHaveBeenCalledWith("org-1", CONNECTION, "admin-1", [{ profileId: PROFILE_A, personId: "100" }]);
  });

  it("refuses a pair whose names don't agree, as with a spouse who shares the email", async () => {
    const res = await post({ links: [{ profileId: PROFILE_B, personId: "100" }] });
    expect(res.status).toBe(409);
    expect(store.insertLinks).not.toHaveBeenCalled();
  });

  it("refuses a name-only match in a group of links", async () => {
    const res = await post({
      links: [
        { profileId: PROFILE_A, personId: "100" },
        { profileId: PROFILE_B, personId: "101" },
      ],
    });
    expect(res.status).toBe(409);
    expect(store.insertLinks).not.toHaveBeenCalled();
  });

  it("refuses a profile outside the church", async () => {
    const res = await post({ links: [{ profileId: "33333333-3333-4333-8333-333333333333", personId: "100" }] });
    expect(res.status).toBe(409);
  });

  it("refuses malformed or repeated pairs", async () => {
    expect((await post({ links: [] })).status).toBe(400);
    expect((await post({ links: [{ profileId: "x", personId: "1" }] })).status).toBe(400);
    expect((await post({ links: [{ profileId: PROFILE_A, personId: 100 }] })).status).toBe(400);
    expect((await post({ links: [{ profileId: PROFILE_A, personId: "1/../2" }] })).status).toBe(400);
    expect(
      (await post({ links: [{ profileId: PROFILE_A, personId: "100" }, { profileId: PROFILE_A, personId: "101" }] })).status,
    ).toBe(400);
  });

  it("links several bulk-confirmable suggestions together", async () => {
    tom.email = "tom@example.org";
    emails[1] = { profile_id: PROFILE_B, email: "tom@example.org" };
    try {
      const res = await post({
        links: [
          { profileId: PROFILE_A, personId: "100" },
          { profileId: PROFILE_B, personId: "101" },
        ],
      });
      expect(res.status).toBe(200);
      expect(store.insertLinks).toHaveBeenCalledTimes(1);
    } finally {
      emails[1] = { profile_id: PROFILE_B, email: "obriens@example.org" };
    }
  });

  it("refuses a bulk pair with a competing candidate, even one left out of the request", async () => {
    // A second Margaret O'Brien profile with the same email: Peggy is no longer the only candidate.
    profiles.push({ id: PROFILE_C, first_name: "Margaret", preferred_name: null, last_name: "OBrien", birth_month: null, birth_day: null, birth_year: null });
    emails.push({ profile_id: PROFILE_C, email: "obriens@example.org" });
    tom.email = "tom@example.org";
    emails[1] = { profile_id: PROFILE_B, email: "tom@example.org" };
    try {
      const res = await post({
        links: [
          { profileId: PROFILE_A, personId: "100" },
          { profileId: PROFILE_B, personId: "101" },
        ],
      });
      expect(res.status).toBe(409);
      expect(store.insertLinks).not.toHaveBeenCalled();
    } finally {
      profiles.pop();
      emails.pop();
      emails[1] = { profile_id: PROFILE_B, email: "obriens@example.org" };
    }
  });

  it("refuses bulk pairs whose last name couldn't be read in full", async () => {
    emails[1] = { profile_id: PROFILE_B, email: "tom@example.org" };
    rock.peopleByLastName.mockResolvedValue({ people: [peggy, tom], truncated: ["Obrien"] });
    try {
      const res = await post({
        links: [
          { profileId: PROFILE_A, personId: "100" },
          { profileId: PROFILE_B, personId: "101" },
        ],
      });
      expect(res.status).toBe(409);
    } finally {
      emails[1] = { profile_id: PROFILE_B, email: "obriens@example.org" };
    }
  });

  it("refuses links when the connection changed after they were checked", async () => {
    store.insertLinks.mockResolvedValue("connection_changed");
    const res = await post({ links: [{ profileId: PROFILE_A, personId: "100" }] });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/connection changed/);
  });

  it("reports an existing link as a conflict", async () => {
    store.insertLinks.mockResolvedValue("conflict");
    expect((await post({ links: [{ profileId: PROFILE_A, personId: "100" }] })).status).toBe(409);
  });
});
