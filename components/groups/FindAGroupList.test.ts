// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DiscoverableGroup } from "@/lib/groups/joining";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

const { DiscoveryRow } = await import("./FindAGroupList");

const group: DiscoverableGroup = {
  id: "group-1",
  name: "Group B",
  description: "Meets Tuesday evenings.",
  member_count: 9,
  is_private: false,
  join_policy: "approval",
  viewer_role: null,
  request_status: null,
};

function mount(element: ReturnType<typeof createElement>) {
  const root = document.createElement("div");
  root.innerHTML = renderToStaticMarkup(element);
  return root;
}

/** The bordered card: the one element carrying the row's rounded border. */
function card(root: HTMLElement) {
  const cards = root.querySelectorAll(".rounded-xl.border");
  expect(cards).toHaveLength(1);
  return cards[0] as HTMLElement;
}

describe("DiscoveryRow layout", () => {
  it.each([
    ["a member", { viewer_role: "member" as const }, ["You are a member", "Open group"]],
    ["an open group", { join_policy: "open" as const }, ["Join"]],
    ["an approval group", {}, ["Request to join"]],
  ])("keeps the actions for %s inside the card", (_, patch, labels) => {
    const root = mount(createElement(DiscoveryRow, { row: { ...group, ...patch }, onChanged: () => {} }));
    const inside = card(root).textContent ?? "";
    expect(inside).toContain("Group B");
    for (const label of labels) expect(inside).toContain(label);
    expect(root.firstElementChild).toBe(card(root));
  });

  it("shows membership as a label, not a button", () => {
    const root = mount(
      createElement(DiscoveryRow, { row: { ...group, viewer_role: "member" }, onChanged: () => {} }),
    );
    const controls = [...root.querySelectorAll("button, a")].map((el) => el.textContent);
    expect(controls).toEqual(["Open group"]);
  });
});
