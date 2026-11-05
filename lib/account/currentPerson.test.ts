import { beforeEach, describe, expect, it, vi } from "vitest";

const createClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
}));
const consoleError = vi.spyOn(console, "log").mockImplementation(() => {});

const { currentPerson } = await import("./currentPerson");

function stubClient(options: { user?: { id: string } | null; authError?: Error | null; profile?: { org_id: string } | null }) {
  createClient.mockResolvedValue({
    auth: {
      getUser: async () => ({ data: { user: options.user ?? null }, error: options.authError ?? null }),
      signOut: vi.fn(async () => {}),
    },
    from: () => ({
      select() {
        return this;
      },
      eq() {
        return this;
      },
      maybeSingle: async () => ({ data: options.profile ?? null, error: null }),
    }),
  });
}

beforeEach(() => {
  createClient.mockReset();
  consoleError.mockClear();
});

describe("currentPerson", () => {
  it("401s and logs when the auth lookup itself fails", async () => {
    stubClient({ authError: new Error("auth down") });
    expect(await currentPerson()).toEqual({ ok: false, status: 401 });
    expect(consoleError).toHaveBeenCalledTimes(1);
  });

  it("401s without a log when there is simply no session", async () => {
    stubClient({ user: null });
    expect(await currentPerson()).toEqual({ ok: false, status: 401 });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("gives the person and the org off their own profile", async () => {
    stubClient({ user: { id: "ada" }, profile: { org_id: "org-1" } });
    expect(await currentPerson()).toMatchObject({ ok: true, id: "ada", orgId: "org-1" });
  });
});
