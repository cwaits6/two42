// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DiscoverableGroup } from "@/lib/groups/joining";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

const { DiscoveryRow } = await import("./FindAGroupList");
const { DirRow } = await import("@/components/directory/DirRow");

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

  it("drops the actions under the text in a narrow row and beside it in a wide one", () => {
    const root = mount(createElement(DiscoveryRow, { row: group, onChanged: () => {} }));
    const row = card(root);
    expect(row.classList).toContain("@container");
    expect(row.classList).toContain("flex-wrap");
    const actions = root.querySelector("button")!.closest(".basis-full") as HTMLElement;
    expect(actions.parentElement).toBe(row);
    expect([...actions.classList]).toEqual(
      expect.arrayContaining(["order-last", "@lg:order-none", "@lg:basis-auto"]),
    );
  });

  it("shows membership as a label, not a button", () => {
    const root = mount(
      createElement(DiscoveryRow, { row: { ...group, viewer_role: "member" }, onChanged: () => {} }),
    );
    const controls = [...root.querySelectorAll("button, a")].map((el) => el.textContent);
    expect(controls).toEqual(["Open group"]);
  });
});

describe("DirRow actions", () => {
  it("keeps actions beside the card for rows that do not stack", () => {
    const root = mount(
      createElement(DirRow, {
        avatar: null,
        title: "Ada",
        onClick: () => {},
        actions: createElement("button", { type: "button" }, "Edit"),
      }),
    );
    const row = card(root);
    expect(row.classList).not.toContain("flex-wrap");
    expect(row.textContent).not.toContain("Edit");
    expect(row.parentElement!.textContent).toContain("Edit");
  });
});
