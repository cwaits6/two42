import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";
import type { DiscoverableGroup } from "@/lib/groups/joining";

class NotFoundSentinel extends Error {}
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFoundSentinel("not-found");
  },
}));

const getDiscoveryOn = vi.fn();
const getDiscoverableGroups = vi.fn();
vi.mock("@/lib/groups/discovery", () => ({
  getDiscoveryOn: () => getDiscoveryOn(),
  getDiscoverableGroups: () => getDiscoverableGroups(),
}));

vi.mock("@/components/groups/CreateGroupAction", () => ({ CreateGroupAction: () => null }));
vi.mock("@/components/groups/FindAGroupList", () => ({
  FindAGroupList: () => null,
  LOAD_FAILED_TEXT: "Couldn't load groups to join. Reload the page to try again.",
}));

const { FindAGroupList, LOAD_FAILED_TEXT } = await import("@/components/groups/FindAGroupList");
const { default: FindAGroupPage } = await import("./page");

const row: DiscoverableGroup = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Grace",
  description: "Thursdays, 7 pm",
  member_count: 4,
  is_private: false,
  join_policy: "approval",
  viewer_role: null,
  request_status: null,
};

function flatten(node: ReactNode, out: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) {
    node.forEach((n) => flatten(n, out));
    return out;
  }
  if (!node || typeof node !== "object" || !("props" in node)) return out;
  const element = node as ReactElement<{ children?: ReactNode }>;
  out.push(element);
  flatten(element.props.children, out);
  return out;
}

function texts(node: ReactNode, out: string[] = []): string[] {
  if (typeof node === "string") {
    out.push(node);
    return out;
  }
  if (Array.isArray(node)) {
    node.forEach((n) => texts(n, out));
    return out;
  }
  if (!node || typeof node !== "object" || !("props" in node)) return out;
  texts((node as ReactElement<{ children?: ReactNode }>).props.children, out);
  return out;
}

beforeEach(() => {
  getDiscoveryOn.mockReset();
  getDiscoverableGroups.mockReset();
});

describe("FindAGroupPage", () => {
  it("404s when discovery is off", async () => {
    getDiscoveryOn.mockResolvedValue(false);

    await expect(FindAGroupPage()).rejects.toBeInstanceOf(NotFoundSentinel);
    expect(getDiscoverableGroups).not.toHaveBeenCalled();
  });

  it("renders the list with the rows the loader returned", async () => {
    getDiscoveryOn.mockResolvedValue(true);
    getDiscoverableGroups.mockResolvedValue([row]);

    const element = await FindAGroupPage();
    const list = flatten(element).find((e) => e.type === FindAGroupList);

    expect(list?.props).toEqual({ initialRows: [row] });
  });

  it("renders the failure line, not an empty list, when the loader returns null", async () => {
    getDiscoveryOn.mockResolvedValue(true);
    getDiscoverableGroups.mockResolvedValue(null);

    const element = await FindAGroupPage();

    expect(flatten(element).some((e) => e.type === FindAGroupList)).toBe(false);
    expect(texts(element)).toContain(LOAD_FAILED_TEXT);
  });
});
