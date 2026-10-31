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

const { default: HomePage, generateMetadata } = await import("./page");

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

  it("describes two42 in the title and description, not a congregation", async () => {
    getOptionalUser.mockResolvedValue(null);
    const metadata = await generateMetadata();
    const title = String(metadata.title);
    const description = String(metadata.description);
    expect(title).toMatch(/two42/);
    expect(description).toMatch(/groups/);
    for (const text of [title, description]) {
      expect(text).not.toMatch(/\bfaith\b|congregation|\bour church\b|first redeemer|body of christ/i);
    }
  });
});
