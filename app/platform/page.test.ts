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

const getPlatformAdmin = vi.fn();
vi.mock("@/lib/platform-access", () => ({
  getPlatformAdmin: () => getPlatformAdmin(),
}));

const organizations = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: async () => ({
    from: () => ({ select: () => organizations() }),
  }),
}));

vi.mock("@/components/states/ErrorState", () => ({ ErrorState: () => null }));

const { ErrorState } = await import("@/components/states/ErrorState");
const { default: PlatformOverviewPage } = await import("./page");

type Element = { type?: unknown; props?: { children?: unknown; href?: string } };

/** Every element in the rendered tree, without calling the components. */
function elementsIn(node: unknown, found: Element[] = []): Element[] {
  if (Array.isArray(node)) {
    for (const child of node) elementsIn(child, found);
    return found;
  }
  if (!node || typeof node !== "object") return found;
  const element = node as Element;
  found.push(element);
  return elementsIn(element.props?.children, found);
}

beforeEach(() => {
  getPlatformAdmin.mockReset();
  getPlatformAdmin.mockResolvedValue({ id: "user-1" });
  organizations.mockReset();
  organizations.mockResolvedValue({ data: [{ id: "o", status: "active" }], error: null });
});

describe("PlatformOverviewPage", () => {
  it("sends a person who is not an operator to Home without reading organizations", async () => {
    getPlatformAdmin.mockResolvedValue(null);

    await expect(PlatformOverviewPage()).rejects.toMatchObject({ target: "/dashboard" });
    expect(organizations).not.toHaveBeenCalled();
  });

  it("links an operator to Settings, where the password form is", async () => {
    const hrefs = elementsIn(await PlatformOverviewPage()).map((element) => element.props?.href);

    expect(hrefs).toContain("/settings");
  });

  it("shows the failed read, not zero organizations, when the count can't be read", async () => {
    organizations.mockResolvedValue({ data: null, error: { code: "57014" } });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const types = elementsIn(await PlatformOverviewPage()).map((element) => element.type);

    expect(types).toContain(ErrorState);
  });
});
