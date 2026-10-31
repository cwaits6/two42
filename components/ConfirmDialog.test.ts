// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "./ConfirmDialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

async function mount(props: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const onOpenChange = vi.fn();
  const onConfirm = vi.fn(async () => {});
  await act(async () =>
    root!.render(
      createElement(ConfirmDialog, {
        open: true,
        onOpenChange,
        title: "Delete General fund?",
        description: "This can't be undone.",
        confirmLabel: "Delete fund",
        pendingLabel: "Deleting…",
        onConfirm,
        ...props,
      }),
    ),
  );
  const button = (label: string) => {
    const match = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === label);
    if (!match) throw new Error(`No button labelled "${label}"`);
    return match;
  };
  return { onOpenChange, onConfirm, button };
}

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("ConfirmDialog", () => {
  it("asks the question, states the consequence and names the action on its button", async () => {
    const { button } = await mount();
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("Delete General fund?");
    expect(dialog?.textContent).toContain("This can't be undone.");
    expect(button("Delete fund").className).toContain("bg-destructive/10");
    expect(Array.from(document.querySelectorAll("button")).some((b) => b.textContent === "OK")).toBe(false);
  });

  it("runs the action and shows it is working until the action settles", async () => {
    let finish!: () => void;
    const onConfirm = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const { button } = await mount({ onConfirm });

    await act(async () => button("Delete fund").click());
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(button("Deleting…").disabled).toBe(true);
    expect(button("Cancel").disabled).toBe(true);

    await act(async () => finish());
    expect(button("Delete fund").disabled).toBe(false);
  });

  it("closes without acting on Cancel", async () => {
    const { button, onOpenChange, onConfirm } = await mount();
    await act(async () => button("Cancel").click());
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
