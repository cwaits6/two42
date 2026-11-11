import { beforeEach, describe, expect, it, vi } from "vitest";

const signOut = vi.fn();
const getSession = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signOut, getSession } }),
}));

const { signOutHere } = await import("./signOut");

const failed = { error: { status: 500 } };
const noSession = { data: { session: null }, error: null };

beforeEach(() => {
  signOut.mockReset();
  getSession.mockReset();
});

describe("signOutHere", () => {
  it("reports a clean sign-out with nothing to say", async () => {
    signOut.mockResolvedValue({ error: null });
    expect(await signOutHere()).toEqual({ signedOut: true });
    expect(getSession).not.toHaveBeenCalled();
  });

  it("signs this device out on its own when signing out everywhere fails", async () => {
    signOut.mockResolvedValueOnce(failed).mockResolvedValueOnce({ error: null });
    getSession.mockResolvedValue(noSession);
    expect(await signOutHere()).toEqual({
      signedOut: true,
      message: "Couldn't sign out everywhere. Other devices may still be signed in.",
    });
    expect(signOut.mock.calls).toEqual([[], [{ scope: "local" }]]);
  });

  it("still reads the session back when signing out this device throws", async () => {
    signOut.mockResolvedValueOnce(failed).mockRejectedValueOnce(new Error("subscriber"));
    getSession.mockResolvedValue({ data: { session: { access_token: "t" } }, error: null });
    expect(await signOutHere()).toEqual({ signedOut: false, message: "Couldn't sign out. Try again." });
  });

  it("reports this device still signed in when the session is still stored", async () => {
    signOut.mockResolvedValue(failed);
    getSession.mockResolvedValue({ data: { session: { access_token: "t" } }, error: null });
    expect(await signOutHere()).toEqual({ signedOut: false, message: "Couldn't sign out. Try again." });
  });

  it("reports this device still signed in when the session can't be read back", async () => {
    signOut.mockResolvedValue(failed);
    getSession.mockResolvedValue({ data: { session: null }, error: { status: 500 } });
    expect(await signOutHere()).toEqual({ signedOut: false, message: "Couldn't sign out. Try again." });
  });

  it("gives the rate limit's next step when that is why the session stayed", async () => {
    signOut.mockResolvedValue({ error: { status: 429 } });
    getSession.mockResolvedValue({ data: { session: null }, error: { status: 429 } });
    expect((await signOutHere()).message).toBe("Couldn't sign out. Wait a minute, then try again.");
  });

  it("says to check the connection when the request never got an answer", async () => {
    signOut.mockResolvedValue({ error: { status: 0 } });
    getSession.mockResolvedValue({ data: { session: null }, error: { status: 0 } });
    expect((await signOutHere()).message).toBe("Couldn't sign out. Check your connection and try again.");
  });
});
