// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LinksData, SuggestionRow } from "./linkLists";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("sonner", () => ({ toast: { error: () => {}, success: () => {} } }));

const { PersonLinks } = await import("./PersonLinks");

function row(i: number, over: Partial<SuggestionRow> = {}): SuggestionRow {
  return {
    profileId: `p${i}`,
    name: `Person ${String(i).padStart(3, "0")}`,
    personId: String(i),
    personName: `Rock Person ${i}`,
    personUrl: `https://rock.example.org/Person/${i}`,
    matched: { email: true, birthday: false },
    confirmableInBulk: true,
    ...over,
  };
}

function data(): LinksData {
  return {
    linked: [{ profileId: "p800", name: "Lena Linked", personId: "800", personUrl: "https://rock.example.org/Person/800", linkedAt: "2026-11-01T00:00:00Z" }],
    suggestions: [
      ...Array.from({ length: 130 }, (_, i) => row(i)),
      row(500, { name: "Tom Obrien", personName: "Thomas Obrien", confirmableInBulk: false, matched: { email: false, birthday: false } }),
      row(501, { profileId: "p500", name: "Tom Obrien", personName: "Thomas Obrien", confirmableInBulk: false }),
      row(600, { name: "Ann Single", confirmableInBulk: false, matched: { email: false, birthday: false } }),
    ],
    unmatched: [{ profileId: "p900", name: "Nora Nomatch" }],
  };
}

let root: Root;
let container: HTMLElement;
let posts: { profileId: string; personId: string }[][];
let failAfter: number;

function button(text: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);
  if (!found) throw new Error(`no button "${text}" in: ${[...document.querySelectorAll("button")].map((b) => b.textContent).join(" | ")}`);
  return found as HTMLButtonElement;
}

async function click(el: HTMLElement) {
  await act(async () => {
    el.click();
  });
}

async function settle() {
  for (let i = 0; i < 10; i++) await act(async () => {});
}

beforeEach(async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  posts = [];
  failAfter = Infinity;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as { links: { profileId: string; personId: string }[] };
      posts.push(body.links);
      if (posts.length > failAfter) return Response.json({ error: "One of these no longer matches." }, { status: 409 });
      return Response.json({ linked: body.links.length });
    }
    return Response.json(data());
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(PersonLinks, { label: "Rock RMS" })));
  await settle();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("PersonLinks", () => {
  it("sorts people into Ready, Check first and No match, each with its count", () => {
    const text = container.textContent ?? "";
    expect(text).toContain("Ready to link · 130");
    expect(text).toContain("Check first · 2");
    expect(text).toContain("No match found · 1");
    // Ready stays collapsed to its count until reviewed.
    expect(text).not.toContain("Person 000");
  });

  it("links everyone ready in batches of at most 100, after confirming", async () => {
    await click(button("Link all 130"));
    expect(document.body.textContent).toContain("Link 130 people?");
    await click(button("Link 130 people"));
    await settle();
    expect(posts.map((p) => p.length)).toEqual([100, 30]);
  });

  it("closes the confirmation once everyone is linked", async () => {
    await click(button("Link all 130"));
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await click(button("Link 130 people"));
    await settle();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.textContent).not.toContain("Link 0 people?");
  });

  it("stops at the first failed batch, closes the confirmation and says how far it got", async () => {
    failAfter = 1;
    await click(button("Link all 130"));
    await click(button("Link 130 people"));
    await settle();
    expect(posts).toHaveLength(2);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Linked 100 of 130, then stopped. One of these no longer matches.",
    );
  });

  it("leaves out anyone unticked in the review list", async () => {
    await click(button("Review list"));
    expect(container.querySelectorAll("li").length).toBeGreaterThanOrEqual(25);
    const first = container.querySelector('[aria-label="Link Person 000"]') as HTMLElement;
    await click(first);
    await click(button("Link 129 selected"));
    await click(button("Link 129 people"));
    await settle();
    expect(posts.flat().some((l) => l.profileId === "p0")).toBe(false);
    expect(posts.flat()).toHaveLength(129);
  });

  it("pages the review list 25 at a time", async () => {
    await click(button("Review list"));
    expect(container.textContent).toContain("Page 1 of 6");
    await click(button("Next"));
    expect(container.textContent).toContain("Person 025");
    expect(container.textContent).not.toContain("Person 000");
  });

  it("tells same-name matches apart by their record id, on screen and in each Link button's name", async () => {
    expect(container.textContent).toContain("2 possible matches");
    await click(button("Choose…"));
    expect(container.textContent).toContain("Rock RMS ID 500");
    expect(container.textContent).toContain("Rock RMS ID 501");
    expect(container.querySelector('[aria-label="Link Tom Obrien to Thomas Obrien, Rock RMS ID 500"]')).not.toBeNull();
    await click(container.querySelector('[aria-label="Link Tom Obrien to Thomas Obrien, Rock RMS ID 501"]') as HTMLElement);
    await settle();
    expect(posts).toEqual([[{ profileId: "p500", personId: "501" }]]);
  });

  it("names the person in each Unlink button", () => {
    expect(container.querySelector('[aria-label="Unlink Lena Linked"]')?.textContent?.trim()).toBe("Unlink");
  });

  it("filters every section by name", async () => {
    const input = container.querySelector('input[type="search"]') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "obrien");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const text = container.textContent ?? "";
    expect(text).toContain("Ready to link · 0");
    expect(text).toContain("Check first · 1");
    expect(text).toContain("No match found · 0");
  });

  it("shows the names with no match only when asked", async () => {
    expect(container.textContent).not.toContain("Nora Nomatch");
    await click(button("Show"));
    expect(container.textContent).toContain("Nora Nomatch");
  });
});
