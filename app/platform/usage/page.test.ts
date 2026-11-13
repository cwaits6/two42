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
const totals = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: async () => ({
    from: () => ({
      select: () => ({
        order: () => organizations(),
      }),
    }),
    rpc: (_fn: string, args: { _org_id: string }) => totals(args._org_id),
  }),
}));

vi.mock("@/components/states/ErrorState", () => ({ ErrorState: () => null }));

const { ErrorState } = await import("@/components/states/ErrorState");
const { UsageLists } = await import("@/components/analytics/UsageLists");
const { default: PlatformUsagePage } = await import("./page");

type Element = { type?: unknown; props?: { children?: unknown; rows?: unknown } };

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

const searchParams = Promise.resolve({ days: "7" });
const listsIn = (node: unknown) => elementsIn(node).filter((element) => element.type === UsageLists);

beforeEach(() => {
  getPlatformAdmin.mockReset().mockResolvedValue({ id: "operator" });
  organizations.mockReset().mockResolvedValue({
    data: [
      { id: "org-a", name: "A" },
      { id: "org-b", name: "B" },
    ],
    error: null,
  });
  totals.mockReset().mockResolvedValue({ data: [{ kind: "view", pattern: "/dashboard", total: 3 }], error: null });
});

describe("PlatformUsagePage", () => {
  it("sends a person who is not an operator to Home without reading anything", async () => {
    getPlatformAdmin.mockResolvedValue(null);
    await expect(PlatformUsagePage({ searchParams })).rejects.toMatchObject({ target: "/dashboard" });
    expect(organizations).not.toHaveBeenCalled();
    expect(totals).not.toHaveBeenCalled();
  });

  it("adds every church's counts together", async () => {
    const [lists] = listsIn(await PlatformUsagePage({ searchParams }));
    expect(totals.mock.calls).toEqual([["org-a"], ["org-b"]]);
    expect(lists.props?.rows).toEqual([{ kind: "view", pattern: "/dashboard", total: 6 }]);
  });

  it("shows a failed read, not a smaller total, when one church can't be read", async () => {
    totals.mockImplementation(async (org: string) =>
      org === "org-b" ? { data: null, error: { code: "57014" } } : { data: [], error: null });
    vi.spyOn(console, "log").mockImplementation(() => {});
    const elements = elementsIn(await PlatformUsagePage({ searchParams }));
    expect(elements.map((element) => element.type)).toContain(ErrorState);
    expect(listsIn(elements)).toEqual([]);
  });
});
