import { beforeEach, describe, expect, it, vi } from "vitest";

class RedirectSentinel extends Error {
  constructor(public readonly target: string) {
    super(`redirect:${target}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (target: string) => {
    throw new RedirectSentinel(target);
  },
}));

const getOptionalUser = vi.fn();
vi.mock("@/lib/supabase/current-user", () => ({
  getOptionalUser: () => getOptionalUser(),
}));

vi.mock("@/components/landing/LandingPage", () => ({ LandingPage: () => null }));

const { default: HomePage } = await import("./page");

beforeEach(() => {
  getOptionalUser.mockReset();
});

describe("HomePage", () => {
  it("sends a signed-in visitor to the dashboard", async () => {
    getOptionalUser.mockResolvedValue({ id: "user-1" });
    await expect(HomePage()).rejects.toMatchObject({ target: "/dashboard" });
  });

  it("renders the front door for everyone else", async () => {
    getOptionalUser.mockResolvedValue(null);
    await expect(HomePage()).resolves.toBeTruthy();
  });
});
