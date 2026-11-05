// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const { useSettingSave } = await import("./useSettingSave");

const write = vi.fn<(next: string) => Promise<boolean>>();

/** A control that shows its value and asks for "new" when pressed. */
function Control() {
  const { value, saving, save } = useSettingSave<string>("old", {
    write,
    saved: (next) => `Saved ${next}.`,
    action: "save the setting",
  });
  return createElement("button", { "data-saving": saving, onClick: () => save("new") }, value);
}

let root: Root;
let host: HTMLDivElement;
const control = () => host.querySelector("button")!;
const change = () => act(async () => control().click());

beforeEach(async () => {
  write.mockReset();
  refresh.mockClear();
  toast.success.mockClear();
  toast.error.mockClear();
  host = document.createElement("div");
  root = createRoot(host);
  await act(async () => root.render(createElement(Control)));
});

afterEach(async () => {
  await act(async () => root.unmount());
});

describe("useSettingSave", () => {
  it("keeps the new value and says what changed once a row is written", async () => {
    write.mockResolvedValue(true);
    await change();

    expect(control().textContent).toBe("new");
    expect(toast.success).toHaveBeenCalledWith("Saved new.");
    expect(refresh).toHaveBeenCalledOnce();
  });

  it.each([
    ["matched no row", () => Promise.resolve(false)],
    ["threw", () => Promise.reject(new Error("network down"))],
  ])("goes back to the saved value and claims nothing when the write %s", async (_case, result) => {
    write.mockImplementation(result);
    await change();

    expect(control().textContent).toBe("old");
    expect(toast.error).toHaveBeenCalledWith("Couldn't save the setting. Try again.");
    expect(toast.success).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("writes nothing and says nothing when the value picked is the one already saved", async () => {
    write.mockResolvedValue(true);
    await change();
    await change();

    expect(write).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("ignores a second change while the first is being written", async () => {
    let settle: (ok: boolean) => void = () => {};
    write.mockImplementation(() => new Promise((resolve) => (settle = resolve)));
    await change();
    await change();

    expect(control().dataset.saving).toBe("true");
    expect(write).toHaveBeenCalledTimes(1);

    await act(async () => settle(true));
    expect(control().textContent).toBe("new");
    expect(control().dataset.saving).toBe("false");
  });
});
