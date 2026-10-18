import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { GROUP_DEFAULT_COLOR, type ActiveGroup } from "@/lib/groups/active";

class NotFoundSentinel extends Error {}

const requireActiveGroup = vi.fn<(groupId: string) => Promise<ActiveGroup>>();
vi.mock("@/lib/groups/server", () => ({
  requireActiveGroup: (groupId: string) => requireActiveGroup(groupId),
}));

const { default: GroupLayout } = await import("./layout");

const A_ID = "11111111-1111-4111-8111-111111111111";
const B_ID = "22222222-2222-4222-8222-222222222222";
const member: ActiveGroup = { id: A_ID, name: "Grace", color: GROUP_DEFAULT_COLOR, role: "member" };

function render(groupId: string) {
  const children = createElement("p", null, "group page");
  return { children, result: GroupLayout({ children, params: Promise.resolve({ groupId }) }) };
}

beforeEach(() => {
  requireActiveGroup.mockReset();
  requireActiveGroup.mockImplementation(async (groupId) => {
    if (groupId === A_ID) return member;
    throw new NotFoundSentinel("not-found");
  });
});

describe("GroupLayout", () => {
  it("404s the whole subtree for a group the viewer is not in", async () => {
    const { result } = render(B_ID);

    await expect(result).rejects.toBeInstanceOf(NotFoundSentinel);
    expect(requireActiveGroup).toHaveBeenCalledWith(B_ID);
  });

  it("404s a malformed id", async () => {
    const { result } = render("not-a-uuid");

    await expect(result).rejects.toBeInstanceOf(NotFoundSentinel);
    expect(requireActiveGroup).toHaveBeenCalledWith("not-a-uuid");
  });

  it("renders the page for a member once the URL's group is verified", async () => {
    const { children, result } = render(A_ID);

    const element = await result;

    expect(requireActiveGroup).toHaveBeenCalledTimes(1);
    expect(requireActiveGroup).toHaveBeenCalledWith(A_ID);
    expect(element.props.children).toBe(children);
  });
});
