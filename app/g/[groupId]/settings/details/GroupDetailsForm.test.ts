// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const refresh = vi.fn();
const groupUpdate = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh, replace: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) =>
    createElement("a", { href }, children),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      update: (fields: unknown) => ({
        eq: () => ({
          select: async () => {
            groupUpdate(fields);
            return { data: [{ id: "g" }], error: null };
          },
        }),
      }),
    }),
  }),
}));
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: (m: string) => toastError(m) } }));

const { GroupDetailsForm } = await import("./GroupDetailsForm");

const TIME = "#zoom-meeting-time";
const URL_FIELD = "#weekly-zoom-url";
const NAME = "#group-name";

let root: Root;
let container: HTMLElement;
let answers: ((res: { ok: boolean; status: number }) => void)[];
let bodies: unknown[];
let urls: string[];

function type(selector: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(selector);
  if (!input) throw new Error(`No input at ${selector}`);
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  return act(async () => void input.dispatchEvent(new Event("input", { bubbles: true })));
}
const pressSave = () =>
  act(async () => {
    container.querySelector("form")?.requestSubmit();
  });
const answerOk = () => act(async () => answers.shift()!({ ok: true, status: 200 }));
const showsUnsaved = () => container.textContent?.includes("You have unsaved changes.");

beforeEach(async () => {
  answers = [];
  bodies = [];
  urls = [];
  groupUpdate.mockReset();
  toastError.mockReset();
  vi.stubGlobal("fetch", (url: string, init: { body: string }) => {
    urls.push(url);
    bodies.push(JSON.parse(init.body));
    return new Promise((resolve) => answers.push(resolve));
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      createElement(GroupDetailsForm, {
        groupId: "11111111-1111-4111-8111-111111111111",
        cancelHref: "/g/11111111-1111-4111-8111-111111111111/settings",
        initialName: "Grace",
        initialDescription: null,
        initialColor: "#B85C38",
        initialVideoCallUrl: "",
        initialVideoCallTime: "",
      }),
    ),
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("GroupDetailsForm", () => {
  it("has nothing to save until a field changes", async () => {
    expect(showsUnsaved()).toBe(false);
    await type(NAME, "Grace ");
    expect(showsUnsaved()).toBe(false);
    await type(NAME, "Hope");
    expect(showsUnsaved()).toBe(true);
  });

  it("writes only the group when only its name changed", async () => {
    await type(NAME, "Hope");
    await pressSave();
    expect(groupUpdate).toHaveBeenCalledWith({ name: "Hope", description: null });
    expect(bodies).toEqual([]);
    expect(showsUnsaved()).toBe(false);
  });

  it("sends only the video call to the shared Save when only it changed", async () => {
    await type(TIME, "Thursdays");
    await pressSave();
    expect(groupUpdate).not.toHaveBeenCalled();
    expect(urls[0]).toBe("/g/11111111-1111-4111-8111-111111111111/about/save");
    expect(bodies[0]).toEqual({ videoCall: { url: "", time: "Thursdays" } });
  });

  it("keeps a field typed during the request on screen, unsaved, and in the next Save", async () => {
    await type(TIME, "Thursdays");
    await pressSave();
    await type(TIME, "Fridays");
    await answerOk();

    expect(container.querySelector<HTMLInputElement>(TIME)?.value).toBe("Fridays");
    expect(showsUnsaved()).toBe(true);

    await pressSave();
    expect(bodies[1]).toEqual({ videoCall: { url: "", time: "Fridays" } });
  });

  it.each([
    [NAME, "  ", "Enter a group name."],
    [URL_FIELD, "http://example.test", "Enter a link that starts with https://"],
  ])("refuses an invalid %s without saving", async (selector, value, message) => {
    await type(selector, value);
    await pressSave();
    expect(container.textContent).toContain(message);
    expect(groupUpdate).not.toHaveBeenCalled();
    expect(bodies).toEqual([]);
  });

  it("keeps the changes unsaved when the Save fails", async () => {
    await type(TIME, "Thursdays");
    await pressSave();
    await act(async () => answers.shift()!({ ok: false, status: 500 }));
    expect(toastError).toHaveBeenCalled();
    expect(showsUnsaved()).toBe(true);
  });
});
