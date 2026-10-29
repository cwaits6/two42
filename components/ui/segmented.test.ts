// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { Segmented, SegmentedLinks } from "./segmented";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SIZES = [
  { value: "default", label: "Default" },
  { value: "large", label: "Large" },
  { value: "larger", label: "Larger" },
] as const;
type Size = (typeof SIZES)[number]["value"];

const DAYS = ["Sun", "Mon", "Tue"].map((label, value) => ({ value, label }));

function SingleChoice() {
  const [value, setValue] = useState<Size>("default");
  return createElement(Segmented<Size>, {
    label: "Text size",
    options: SIZES,
    value,
    onChange: setValue,
  });
}

function ManyChoices({ onChange }: { onChange: (days: number[]) => void }) {
  const [value, setValue] = useState<number[]>([1]);
  return createElement(Segmented<number>, {
    label: "Reminder days",
    multiple: true,
    options: DAYS,
    value,
    onChange: (days: number[]) => {
      onChange(days);
      setValue(days);
    },
  });
}

let mounted: { root: Root; container: HTMLElement } | null = null;

async function mount(element: ReturnType<typeof createElement>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted = { root, container };
  await act(async () => root.render(element));
  const buttons = () => Array.from(container.querySelectorAll("button"));
  const byLabel = (label: string) => {
    const button = buttons().find((b) => b.textContent === label);
    if (!button) throw new Error(`No option labelled "${label}"`);
    return button;
  };
  return {
    container,
    byLabel,
    pressed: () =>
      buttons()
        .filter((b) => b.getAttribute("aria-pressed") === "true")
        .map((b) => b.textContent),
    focused: () => (document.activeElement as HTMLElement | null)?.textContent,
    async click(label: string) {
      await act(async () => byLabel(label).click());
    },
    async key(key: string) {
      await act(async () => {
        document.activeElement?.dispatchEvent(
          new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
        );
      });
    },
  };
}

afterEach(async () => {
  if (!mounted) return;
  const { root, container } = mounted;
  await act(async () => root.unmount());
  container.remove();
  mounted = null;
});

describe("Segmented", () => {
  it("names the group and marks only the chosen option pressed", async () => {
    const view = await mount(createElement(SingleChoice));
    expect(view.container.querySelector('[role="group"]')?.getAttribute("aria-label")).toBe(
      "Text size",
    );
    expect(view.pressed()).toEqual(["Default"]);

    await view.click("Larger");
    expect(view.pressed()).toEqual(["Larger"]);
  });

  it("toggles each option on its own with multiple", async () => {
    const changes: number[][] = [];
    const view = await mount(createElement(ManyChoices, { onChange: (d) => changes.push(d) }));

    await view.click("Tue");
    expect(view.pressed()).toEqual(["Mon", "Tue"]);
    await view.click("Mon");
    expect(view.pressed()).toEqual(["Tue"]);
    expect(changes).toEqual([[1, 2], [2]]);
  });

  it("renders native buttons that never submit a form", async () => {
    const view = await mount(createElement(SingleChoice));
    for (const label of ["Default", "Large", "Larger"]) {
      const button = view.byLabel(label);
      expect(button.type).toBe("button");
      expect(button.tabIndex).toBe(0);
    }
  });

  it("moves focus with the arrow keys, wrapping at both ends, without changing the choice", async () => {
    const view = await mount(createElement(SingleChoice));
    view.byLabel("Default").focus();

    await view.key("ArrowRight");
    expect(view.focused()).toBe("Large");
    await view.key("ArrowDown");
    expect(view.focused()).toBe("Larger");
    await view.key("ArrowRight");
    expect(view.focused()).toBe("Default");
    await view.key("ArrowLeft");
    expect(view.focused()).toBe("Larger");
    await view.key("ArrowUp");
    expect(view.focused()).toBe("Large");
    expect(view.pressed()).toEqual(["Default"]);
  });

  it("jumps to the first and last option with Home and End", async () => {
    const view = await mount(createElement(SingleChoice));
    view.byLabel("Large").focus();

    await view.key("End");
    expect(view.focused()).toBe("Larger");
    await view.key("Home");
    expect(view.focused()).toBe("Default");
  });

  it("leaves other keys to the browser", async () => {
    const view = await mount(createElement(SingleChoice));
    view.byLabel("Large").focus();
    const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    await act(async () => {
      document.activeElement?.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(false);
    expect(view.focused()).toBe("Large");
  });

  it("reserves a 44 px target on every option", async () => {
    const view = await mount(createElement(SingleChoice));
    for (const label of ["Default", "Large", "Larger"]) {
      const classes = view.byLabel(label).className.split(/\s+/);
      expect(classes).toContain("min-h-11");
      expect(classes).toContain("min-w-11");
      expect(classes).toContain("text-base");
    }
  });
});

describe("SegmentedLinks", () => {
  it("marks the current link with aria-current instead of aria-pressed", () => {
    const html = renderToStaticMarkup(
      createElement(SegmentedLinks, {
        label: "Lecture view",
        options: [
          { href: "/lectures", label: "By Series", current: false },
          { href: "/lectures?view=all", label: "All Lectures", current: true },
        ],
      }),
    );
    expect(html).toContain('aria-label="Lecture view"');
    expect(html).not.toContain("aria-pressed");
    expect(html).toMatch(/<a aria-current="page"[^>]*href="\/lectures\?view=all"/);
    expect(html.match(/aria-current/g)).toHaveLength(1);
  });
});
