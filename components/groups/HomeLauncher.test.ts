import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";
import type { ActiveGroup } from "@/lib/groups/active";
import { GROUP_DEFAULT_COLOR } from "@/lib/groups/calendar";
import type { HomeData } from "@/lib/groups/home";

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/time/orgZone", () => ({ getOrgTimeZone: async () => "America/New_York" }));

const loadHomeCards = vi.fn<() => Promise<HomeData | null>>();
vi.mock("@/lib/groups/home", () => ({
  loadHomeCards: () => loadHomeCards(),
}));

vi.mock("@/components/states/ErrorState", () => ({ ErrorState: () => null }));

const { ErrorState } = await import("@/components/states/ErrorState");
const { HomeLauncher } = await import("./HomeLauncher");

const A: ActiveGroup = { id: "a", name: "Grace", color: GROUP_DEFAULT_COLOR, role: "leader" };
const B: ActiveGroup = { id: "b", name: "Hope", color: GROUP_DEFAULT_COLOR, role: "member" };

function failedSections(node: ReactNode, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    node.forEach((n) => failedSections(n, out));
    return out;
  }
  if (!node || typeof node !== "object" || !("props" in node)) return out;
  const element = node as ReactElement<{ thing?: string; children?: ReactNode }>;
  if (element.type === ErrorState) out.push(element.props.thing ?? "");
  failedSections(element.props.children, out);
  return out;
}

function texts(node: ReactNode, out: string[] = []): string[] {
  if (typeof node === "string" || typeof node === "number") {
    out.push(String(node));
    return out;
  }
  if (Array.isArray(node)) {
    node.forEach((n) => texts(n, out));
    return out;
  }
  if (!node || typeof node !== "object" || !("props" in node)) return out;
  const element = node as ReactElement<{ children?: ReactNode }>;
  texts(element.props.children, out);
  return out;
}

function hrefs(node: ReactNode, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    node.forEach((n) => hrefs(n, out));
    return out;
  }
  if (!node || typeof node !== "object" || !("props" in node)) return out;
  const element = node as ReactElement<{ href?: string; children?: ReactNode }>;
  if (typeof element.props.href === "string") out.push(element.props.href);
  hrefs(element.props.children, out);
  return out;
}

/** Function components nested in the tree are rendered so their text is visible. */
function expand(node: ReactNode): ReactNode {
  if (Array.isArray(node)) return node.map(expand);
  if (!node || typeof node !== "object" || !("props" in node)) return node;
  const element = node as ReactElement<{ children?: ReactNode }>;
  if (typeof element.type === "function" && element.type !== ErrorState) {
    const Component = element.type as (props: unknown) => ReactNode;
    return expand(Component(element.props));
  }
  return { ...element, props: { ...element.props, children: expand(element.props.children) } };
}

async function render() {
  const element = await HomeLauncher({
    memberships: [A, B],
    discoveryOn: false,
    displayName: null,
    orgId: "org-1",
  });
  return expand(element);
}

beforeEach(() => {
  loadHomeCards.mockReset();
});

describe("HomeLauncher", () => {
  it("shows each group's activity and the week when the loader succeeds", async () => {
    loadHomeCards.mockResolvedValue({
      cards: [
        { group: A, nextEvent: null, announcementCount: 4, prayerCount: 1 },
        { group: B, nextEvent: null, announcementCount: 4, prayerCount: 1 },
      ],
      thisWeek: [],
    });

    const tree = await render();
    const text = texts(tree).join("");

    expect(text).toContain("4 announcements");
    expect(text).toContain("1 prayer request");
    expect(text).toContain("This week");
    expect(failedSections(tree)).toEqual([]);
  });

  it("greets without a stand-in name when there is none", async () => {
    loadHomeCards.mockResolvedValue({ cards: [], thisWeek: [] });

    const text = texts(await render()).join("");

    expect(text).not.toContain("Friend");
    expect(text).toMatch(/Good (morning|afternoon|evening)\./);
  });

  it("says the read failed and keeps the group links, with no counts or week", async () => {
    loadHomeCards.mockResolvedValue(null);

    const tree = await render();
    const text = texts(tree).join("");

    expect(failedSections(tree)).toEqual(["your groups' activity"]);
    expect(text).not.toContain("announcement");
    expect(text).not.toContain("No upcoming events");
    expect(text).not.toContain("This week");
    expect(hrefs(tree)).toEqual(["/g/a/dashboard", "/g/b/dashboard"]);
  });
});
