// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GroupSettingsValues } from "@/lib/groups/settings";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) =>
    createElement("a", { href }, children),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/uploadImage", () => ({ mintSignedUrls: async () => [] }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("./CalendarSubscriptionCard", () => ({ CalendarSubscriptionCard: () => null }));
vi.mock("@/components/editor", () => ({
  BlockEditor: ({ onChange }: { onChange: (blocks: unknown[]) => void }) =>
    createElement("input", {
      "data-testid": "summary",
      onChange: (e: { target: { value: string } }) => onChange([e.target.value]),
    }),
}));

const { AboutEditor } = await import("./AboutEditor");

let root: Root;
let container: HTMLElement;
let answers: ((res: { ok: boolean; status: number }) => void)[];
let bodies: unknown[];

function type(selector: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(selector);
  if (!input) throw new Error(`No input at ${selector}`);
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  return act(async () => void input.dispatchEvent(new Event("input", { bubbles: true })));
}
const TIME = "#zoom-meeting-time";
const SUMMARY = '[data-testid="summary"]';

const saveButton = () =>
  [...container.querySelectorAll("button")].find((b) => /^Sav(e changes|ing…)$/.test(b.textContent ?? ""))!;
const pressSave = () => act(async () => saveButton().click());
const answerOk = () => act(async () => answers.shift()!({ ok: true, status: 200 }));
const showsUnsaved = () => container.textContent?.includes("You have unsaved changes.");

beforeEach(async () => {
  answers = [];
  bodies = [];
  vi.stubGlobal("fetch", (_url: string, init: { body: string }) => {
    bodies.push(JSON.parse(init.body));
    return new Promise((resolve) => answers.push(resolve));
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      createElement(AboutEditor, {
        groupId: "11111111-1111-4111-8111-111111111111",
        groupName: "Grace",
        initialBody: "",
        initialTeachers: [],
        initialColor: "#B85C38",
        initialSettings: {} as GroupSettingsValues,
      }),
    ),
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("AboutEditor while a Save is in flight", () => {
  it("settles with nothing unsaved when nothing was typed during the request", async () => {
    await type(TIME, "Thursdays");
    await type(SUMMARY, "Hello");
    await pressSave();
    await answerOk();
    expect(showsUnsaved()).toBe(false);
    expect(saveButton().disabled).toBe(true);
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

  it("keeps a summary edited during the request unsaved, and in the next Save", async () => {
    await type(SUMMARY, "First");
    await pressSave();
    await type(SUMMARY, "Second");
    await answerOk();

    expect(showsUnsaved()).toBe(true);

    await pressSave();
    expect(bodies[1]).toEqual({ summary: JSON.stringify(["Second"]) });
  });
});
