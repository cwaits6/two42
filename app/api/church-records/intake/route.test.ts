import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const after = vi.fn();
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (task: () => unknown) => after(task),
}));

let user: { id: string; email?: string } | null;
let profile: Record<string, unknown> | null;
const selected: string[] = [];
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user } }) },
    from: () => {
      const chain = {
        select: (columns: string) => (selected.push(columns), chain),
        eq: () => chain,
        single: async () => ({ data: profile, error: profile ? null : { code: "PGRST116" } }),
      };
      return chain;
    },
  }),
}));

const intake = vi.hoisted(() => ({ acceptConsent: vi.fn(), sendNewPerson: vi.fn(), withdrawConsent: vi.fn() }));
vi.mock("@/lib/integrations/records/intake", () => intake);

const { POST } = await import("./route");

function post(body: unknown) {
  return POST(new Request("http://test/api/church-records/intake", { method: "POST", body: JSON.stringify(body) }));
}

const MEMBER = {
  org_id: "org-1",
  role: "member",
  first_name: "Nora",
  last_name: "Setupwell",
  phone_mobile: null,
  phone_home: "5559876543",
};

beforeEach(() => {
  vi.clearAllMocks();
  selected.length = 0;
  process.env.RECORDS_KEY_SECRET = randomBytes(32).toString("base64");
  user = { id: "p1", email: "nora@example.test" };
  profile = { ...MEMBER };
  intake.acceptConsent.mockResolvedValue("acc-1");
});

describe("POST /api/church-records/intake", () => {
  it("doesn't exist without RECORDS_KEY_SECRET", async () => {
    delete process.env.RECORDS_KEY_SECRET;
    expect((await post({ share: true })).status).toBe(404);
  });

  it("turns away someone signed out, a pending person and a malformed body", async () => {
    user = null;
    expect((await post({ share: true })).status).toBe(401);
    user = { id: "p1", email: "nora@example.test" };
    expect((await post({ share: "yes" })).status).toBe(400);
    profile = { ...MEMBER, role: "pending" };
    expect((await post({ share: true })).status).toBe(403);
    expect(after).not.toHaveBeenCalled();
  });

  it("sends after the response, with only the person's own name, sign-in email and phone, whatever the body says", async () => {
    const res = await post({ share: true, firstName: "Mallory", email: "mallory@example.test", org_id: "org-2" });
    expect(res.status).toBe(202);
    expect(selected).toEqual(["org_id, role, first_name, last_name, phone_mobile, phone_home"]);
    expect(intake.acceptConsent).toHaveBeenCalledWith("org-1", "p1");
    expect(intake.sendNewPerson).not.toHaveBeenCalled();
    await after.mock.calls[0][0]();
    expect(intake.sendNewPerson).toHaveBeenCalledWith(
      "org-1",
      "p1",
      "acc-1",
      { firstName: "Nora", lastName: "Setupwell", email: "nora@example.test", phone: "5559876543" },
      { current: expect.any(Buffer), previous: null },
    );
  });

  it("withdraws a consent when unticked, and sends nothing", async () => {
    intake.withdrawConsent.mockResolvedValue("withdrawn");
    expect((await post({ share: false })).status).toBe(200);
    expect(intake.withdrawConsent).toHaveBeenCalledWith("org-1", "p1");
    expect(after).not.toHaveBeenCalled();
  });

  it("queues nothing when there is nothing to accept, and answers 500 when the acceptance can't be saved", async () => {
    intake.acceptConsent.mockResolvedValue(null);
    expect((await post({ share: true })).status).toBe(200);
    intake.acceptConsent.mockRejectedValue(new Error("down"));
    expect((await post({ share: true })).status).toBe(500);
    expect(after).not.toHaveBeenCalled();
  });

  it("never confirms a withdrawal once a send was claimed", async () => {
    intake.withdrawConsent.mockResolvedValue("too_late");
    const res = await post({ share: false });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Your details may already be on their way to the church office.", alreadySent: true });
    expect(after).not.toHaveBeenCalled();
  });

  it("sends nothing for a person with no name yet", async () => {
    profile = { ...MEMBER, last_name: " " };
    expect((await post({ share: true })).status).toBe(200);
    expect(after).not.toHaveBeenCalled();
  });
});
