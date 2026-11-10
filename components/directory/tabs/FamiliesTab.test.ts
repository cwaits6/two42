// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FamilyDirectoryFull } from "@/lib/types";

const search = vi.hoisted(() => ({ query: "" }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search.query),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown }) =>
    createElement("a", { href, ...rest }, children as never),
}));

const family = {
  id: "miller",
  family_name: "Miller",
  photo_url: null,
  members: [],
  family_members_list: [],
} as unknown as FamilyDirectoryFull;

// One value across renders, as the provider gives: the deep-link effect re-runs on a new map.
const directory = {
  members: [],
  families: [family],
  memberships: [{ id: "g" }],
  profileMap: {},
  familyMap: { [family.id]: family },
  basePath: "/directory",
  loading: false,
  error: false,
  reload: () => {},
};
vi.mock("@/components/directory/DirectoryContext", () => ({ useDirectory: () => directory }));
vi.mock("@/components/directory/FamilyCard", () => ({ FamilyCard: () => null }));

const { FamiliesTab } = await import("./FamiliesTab");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  window.scrollTo = () => {};
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function open(query: string) {
  search.query = query;
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root.render(createElement(FamiliesTab)));
}

const backToList = () =>
  [...host.querySelectorAll("a, button")].find((el) => el.textContent === "Back to the list")!;

describe("FamiliesTab's way back to the list", () => {
  it("leads a household opened from Birthdays, This week back to that list", async () => {
    await open("family=miller&from=birthdays&when=week");
    expect(backToList().getAttribute("href")).toBe("/directory/birthdays?when=week");
  });

  it("keeps a household opened from Households on Households", async () => {
    await open("family=miller");
    expect(backToList().tagName).toBe("BUTTON");
    await act(async () => (backToList() as HTMLButtonElement).click());
    expect(host.textContent).toContain("Choose a household from the list");
  });

  it("stays on Households for a tab it does not know", async () => {
    await open("family=miller&from=//example.test");
    expect(backToList().tagName).toBe("BUTTON");
  });

  it("leads a household picked from the list back to the list, whatever the link carried", async () => {
    await open("family=miller&from=birthdays&when=week");
    const row = [...host.querySelectorAll("button")].find((el) => el.textContent?.includes("Miller"))!;
    await act(async () => row.click());
    expect(backToList().tagName).toBe("BUTTON");
  });
});
