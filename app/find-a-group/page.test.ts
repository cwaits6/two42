import { beforeEach, describe, expect, it, vi } from "vitest";

class NotFoundSentinel extends Error {}
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFoundSentinel("not-found");
  },
}));

const getDiscoveryOn = vi.fn();
vi.mock("@/lib/groups/discovery", () => ({
  getDiscoveryOn: () => getDiscoveryOn(),
}));

const { default: FindAGroupPage } = await import("./page");

beforeEach(() => {
  getDiscoveryOn.mockReset();
});

describe("FindAGroupPage", () => {
  it("404s when discovery is off", async () => {
    getDiscoveryOn.mockResolvedValue(false);

    await expect(FindAGroupPage()).rejects.toBeInstanceOf(NotFoundSentinel);
  });

  it("renders when discovery is on", async () => {
    getDiscoveryOn.mockResolvedValue(true);

    const element = await FindAGroupPage();

    expect(element).toBeTruthy();
  });
});
