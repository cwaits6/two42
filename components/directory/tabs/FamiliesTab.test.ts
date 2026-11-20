// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DirectoryProfile, FamilyDirectoryFull } from "@/lib/types";

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
  members: [{ id: "in-miller", first_name: "Ben", last_name: "Miller", relationship: "primary" }],
  family_members_list: [],
} as unknown as FamilyDirectoryFull;

// Henry is listed; Chloe's account is hidden from the directory, so the view
// leaves her out of `members` but keeps her claimed household record.
const mockingham = {
  id: "mockingham",
  family_name: "Mockingham",
  photo_url: null,
  members: [{ id: "henry", first_name: "Henry", last_name: "Mockingham", relationship: "primary" }],
  family_members_list: [
    { id: "fm-chloe", first_name: "Chloe", last_name: "Mockingham", relationship: "spouse", claimed_profile_id: "chloe" },
  ],
} as unknown as FamilyDirectoryFull;

// Everyone in it is hidden from the directory.
const hidden = {
  id: "hidden",
  family_name: "Quietly",
  photo_url: null,
  members: [],
  family_members_list: [
    { id: "fm-q", first_name: "Quinn", last_name: "Quietly", relationship: "primary", claimed_profile_id: "quinn" },
  ],
} as unknown as FamilyDirectoryFull;

const solo = { id: "solo", first_name: "Ava", last_name: "Sampleton", family_id: null } as unknown as DirectoryProfile;
const inMiller = { id: "in-miller", first_name: "Ben", last_name: "Miller", family_id: "miller" } as unknown as DirectoryProfile;

// One value across renders, as the provider gives: the deep-link effect re-runs on a new map.
const directory = {
  members: [],
  families: [family, mockingham, hidden],
  memberships: [{ id: "g" }],
  profileMap: { [solo.id]: solo, [inMiller.id]: inMiller },
  familyMap: { [family.id]: family },
  basePath: "/directory",
  loading: false,
  error: false,
  reload: () => {},
};
vi.mock("@/components/directory/DirectoryContext", () => ({ useDirectory: () => directory }));
vi.mock("@/components/directory/FamilyCard", () => ({ FamilyCard: () => null }));
vi.mock("@/components/directory/PersonCard", () => ({ PersonCard: () => null }));

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

  it("leads a person with no household, opened from Birthdays, back to that list", async () => {
    await open("person=solo&from=birthdays&when=week");
    expect(backToList().getAttribute("href")).toBe("/directory/birthdays?when=week");
  });

  it("leads a person in a household back to the household, not the list", async () => {
    await open("person=in-miller&from=birthdays&when=week");
    const back = [...host.querySelectorAll("a, button")].find((el) => el.textContent === "Back to Miller")!;
    expect(back.tagName).toBe("BUTTON");
  });
});

describe("FamiliesTab's open household in the URL", () => {
  const row = (name: string) =>
    [...host.querySelectorAll("button")].find((el) => el.textContent?.includes(name))!;

  it("reopens a household picked from the list when the page is opened again, as after Back", async () => {
    await open("");
    await act(async () => row("Miller").click());
    expect(window.location.pathname + window.location.search).toBe("/directory/families?family=miller");

    const written = window.location.search.slice(1);
    await act(async () => root.unmount());
    host.remove();
    await open(written);
    expect(backToList()).toBeDefined();
    expect(host.textContent).not.toContain("Choose a household from the list");
  });

  it("writes the household without the deep link's way back when picked from the list", async () => {
    await open("family=miller&from=birthdays&when=week");
    await act(async () => row("Miller").click());
    expect(window.location.search).toBe("?family=miller");
  });

  it("clears the household from the URL on Back to the list", async () => {
    await open("family=miller");
    await act(async () => (backToList() as HTMLButtonElement).click());
    expect(window.location.pathname + window.location.search).toBe("/directory/families");
  });

  it("does not add a history entry for each household opened", async () => {
    const pushState = vi.spyOn(window.history, "pushState");
    await open("");
    await act(async () => row("Miller").click());
    await act(async () => row("Mockingham").click());
    expect(pushState).not.toHaveBeenCalled();
    pushState.mockRestore();
  });
});

describe("FamiliesTab and people hidden from the directory", () => {
  const typeSearch = async (value: string) => {
    const input = host.querySelector<HTMLInputElement>('input[type="search"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };

  it("names only the listed adult of a household whose spouse is hidden", async () => {
    await open("");
    expect(host.textContent).toContain("Henry");
    expect(host.textContent).not.toContain("Chloe");
  });

  it("finds no household by a hidden person's name", async () => {
    await open("");
    await typeSearch("chloe");
    expect(host.textContent).toContain("No households match your search.");
  });

  it("leaves out a household whose people are all hidden", async () => {
    await open("");
    expect(host.textContent).not.toContain("Quietly");
  });
});
