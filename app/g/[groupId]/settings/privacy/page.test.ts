import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";
import type { ActiveGroup } from "@/lib/groups/active";
import { GROUP_DEFAULT_COLOR } from "@/lib/groups/calendar";

class NotFoundSentinel extends Error {}

const requireGroupLeader = vi.fn();
vi.mock("@/lib/groups/server", () => ({
  requireGroupLeader: (groupId: string) => requireGroupLeader(groupId),
}));

const getDiscoveryOn = vi.fn();
vi.mock("@/lib/groups/discovery", () => ({
  getDiscoveryOn: () => getDiscoveryOn(),
}));

const groupFlags = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => groupFlags(),
        }),
      }),
    }),
  }),
}));

vi.mock("./PrivacyAndJoiningManager", () => ({ PrivacyAndJoiningManager: () => null }));

const { PrivacyAndJoiningManager } = await import("./PrivacyAndJoiningManager");
const { default: GroupPrivacySettingsPage } = await import("./page");

const A_ID = "11111111-1111-4111-8111-111111111111";
const leader: ActiveGroup = { id: A_ID, name: "Grace", color: GROUP_DEFAULT_COLOR, role: "leader" };
const UNAVAILABLE_TEXT =
  "Couldn't load this group's privacy settings. Reload the page to try again.";

type Element = ReactElement<{ children?: ReactNode; role?: string }>;

function flatten(node: ReactNode, out: Element[] = []): Element[] {
  if (Array.isArray(node)) {
    node.forEach((n) => flatten(n, out));
    return out;
  }
  if (!node || typeof node !== "object" || !("props" in node)) return out;
  const element = node as Element;
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

function expectUnavailable(element: ReactElement) {
  const nodes = flatten(element);
  expect(nodes.some((e) => e.type === PrivacyAndJoiningManager)).toBe(false);
  expect(nodes.find((e) => e.props.role === "alert")).toBeDefined();
  expect(texts(element)).toContain(UNAVAILABLE_TEXT);
}

beforeEach(() => {
  requireGroupLeader.mockReset();
  getDiscoveryOn.mockReset();
  groupFlags.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GroupPrivacySettingsPage", () => {
  it("does not render for a member who does not lead the group", async () => {
    requireGroupLeader.mockRejectedValue(new NotFoundSentinel("not found"));

    await expect(
      GroupPrivacySettingsPage({ params: Promise.resolve({ groupId: A_ID }) }),
    ).rejects.toBeInstanceOf(NotFoundSentinel);
    expect(requireGroupLeader).toHaveBeenCalledWith(A_ID);
  });

  it("renders the manager with the group's flags and the org switch when the viewer leads it", async () => {
    requireGroupLeader.mockResolvedValue(leader);
    getDiscoveryOn.mockResolvedValue(true);
    groupFlags.mockReturnValue({ data: { is_private: true, join_policy: "open" }, error: null });

    const element = await GroupPrivacySettingsPage({ params: Promise.resolve({ groupId: A_ID }) });

    expect(element.type).toBe(PrivacyAndJoiningManager);
    expect(element.props).toEqual({
      groupId: A_ID,
      groupName: "Grace",
      initialPrivate: true,
      initialPolicy: "open",
      orgDiscoveryOn: true,
    });
  });

  it("shows the unavailable notice, not the controls, when the flags read fails", async () => {
    requireGroupLeader.mockResolvedValue(leader);
    getDiscoveryOn.mockResolvedValue(true);
    groupFlags.mockReturnValue({ data: null, error: { code: "57014", message: "canceled" } });

    const element = await GroupPrivacySettingsPage({ params: Promise.resolve({ groupId: A_ID }) });

    expectUnavailable(element);
    expect(console.error).toHaveBeenCalled();
  });

  it("shows the unavailable notice when the flags read returns no row", async () => {
    requireGroupLeader.mockResolvedValue(leader);
    getDiscoveryOn.mockResolvedValue(false);
    groupFlags.mockReturnValue({ data: null, error: null });

    const element = await GroupPrivacySettingsPage({ params: Promise.resolve({ groupId: A_ID }) });

    expectUnavailable(element);
  });
});
