// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { LessonThumbnail } from "./LessonThumbnail";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const YOUTUBE = "https://img.youtube.com/vi/jNQXAC9IVRw/hqdefault.jpg";

let root: Root | null = null;

async function mount(src: string | null) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(createElement(LessonThumbnail, { src, fallback: createElement("span", { "data-fallback": "" }) })),
  );
  return {
    img: () => container.querySelector("img"),
    fallback: () => container.querySelector("[data-fallback]"),
  };
}

// jsdom never loads pictures, so the size the browser would report is stubbed on the element.
function settle(img: HTMLImageElement, naturalWidth: number, naturalHeight: number) {
  Object.defineProperty(img, "naturalWidth", { value: naturalWidth, configurable: true });
  Object.defineProperty(img, "naturalHeight", { value: naturalHeight, configurable: true });
}

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("LessonThumbnail", () => {
  it("shows the fallback and no picture when there is no source", async () => {
    const { img, fallback } = await mount(null);
    expect(img()).toBeNull();
    expect(fallback()).not.toBeNull();
  });

  it("shows the picture and keeps the fallback out while it loads", async () => {
    const { img, fallback } = await mount(YOUTUBE);
    expect(img()?.getAttribute("src")).toBe(YOUTUBE);
    expect(fallback()).toBeNull();
  });

  it("keeps a picture the browser decoded", async () => {
    const { img, fallback } = await mount(YOUTUBE);
    settle(img()!, 480, 360);
    await act(async () => img()!.dispatchEvent(new Event("load")));
    expect(img()).not.toBeNull();
    expect(fallback()).toBeNull();
  });

  it("gives way to the fallback when the browser cannot load the picture", async () => {
    const { img, fallback } = await mount(YOUTUBE);
    await act(async () => img()!.dispatchEvent(new Event("error")));
    expect(img()).toBeNull();
    expect(fallback()).not.toBeNull();
  });

  it("gives way to the fallback when YouTube answers with its removed-video card", async () => {
    const { img, fallback } = await mount(YOUTUBE);
    settle(img()!, 120, 90);
    await act(async () => img()!.dispatchEvent(new Event("load")));
    expect(img()).toBeNull();
    expect(fallback()).not.toBeNull();
  });

  it("notices a picture that already failed before the handlers attached", async () => {
    const proto = HTMLImageElement.prototype;
    const complete = Object.getOwnPropertyDescriptor(proto, "complete")!;
    const naturalWidth = Object.getOwnPropertyDescriptor(proto, "naturalWidth")!;
    Object.defineProperty(proto, "complete", { get: () => true, configurable: true });
    Object.defineProperty(proto, "naturalWidth", { get: () => 0, configurable: true });
    try {
      const { img, fallback } = await mount(YOUTUBE);
      expect(img()).toBeNull();
      expect(fallback()).not.toBeNull();
    } finally {
      Object.defineProperty(proto, "complete", complete);
      Object.defineProperty(proto, "naturalWidth", naturalWidth);
    }
  });
});
