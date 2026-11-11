// @vitest-environment jsdom
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no canvas; the crop math stays real, only the draw is replaced.
const renderCrop = vi.fn(async () => new File(["square"], "avatar.jpg", { type: "image/jpeg" }));
vi.mock("@/lib/avatarCrop", async (original) => ({
  ...(await original<typeof import("@/lib/avatarCrop")>()),
  renderCrop,
}));
vi.mock("@/lib/log", () => ({ logWarn: vi.fn() }));

const { AvatarCropStep } = await import("./AvatarCropStep");

// jsdom neither decodes pictures nor reports their size.
function stubPicture(decodes: boolean) {
  Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", {
    configurable: true,
    get: () => 3024,
  });
  Object.defineProperty(HTMLImageElement.prototype, "naturalHeight", {
    configurable: true,
    get: () => 4032,
  });
  HTMLImageElement.prototype.decode = decodes
    ? async () => {}
    : async () => {
        throw new Error("not a picture");
      };
}

let root: Root;
const onSave = vi.fn(async () => {});
const onLoadError = vi.fn();
const onClosed = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  URL.createObjectURL = () => "blob:picked";
  URL.revokeObjectURL = () => {};
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

async function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      createElement(AvatarCropStep, {
        file: new File(["x"], "picked.png", { type: "image/png" }),
        returnFocusRef: createRef<HTMLElement>(),
        onSave,
        onLoadError,
        onClosed,
      }),
    ),
  );
}

const frame = () => document.querySelector<HTMLElement>('[aria-label="Photo position"]');

describe("AvatarCropStep", () => {
  it("shows the error and closes without saving when the picture fails to load", async () => {
    stubPicture(false);
    await mount();
    await vi.waitFor(() => expect(onClosed).toHaveBeenCalledOnce());
    expect(onLoadError).toHaveBeenCalledOnce();
    expect(onSave).not.toHaveBeenCalled();
    expect(frame()).toBeNull();
  });

  it("saves the position the frame shows", async () => {
    stubPicture(true);
    await mount();
    await vi.waitFor(() => expect(frame()).not.toBeNull());
    await act(async () => {
      frame()!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    const save = [...document.querySelectorAll("button")].find(
      (b) => b.textContent === "Save photo",
    );
    await act(async () => save!.click());
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(renderCrop).toHaveBeenCalledWith(expect.anything(), { zoom: 1, x: 0, y: 8 });
    expect(onSave).toHaveBeenCalledWith(await renderCrop.mock.results[0].value);
    expect(onLoadError).not.toHaveBeenCalled();
  });
});
