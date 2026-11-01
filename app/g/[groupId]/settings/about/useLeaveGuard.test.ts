// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const { leavingHref, useLeaveGuard } = await import("./useLeaveGuard");

const HERE = "https://two42.test/g/1/settings/about?x=1";
const click = {
  button: 0,
  modified: false,
  defaultPrevented: false,
  href: "https://two42.test/g/1/settings",
  target: null,
  download: false,
};

describe("leavingHref", () => {
  it("holds a plain click on a link to another page", () => {
    expect(leavingHref(click, HERE)).toBe("https://two42.test/g/1/settings");
  });

  it("holds a link to another site", () => {
    expect(leavingHref({ ...click, href: "https://example.test/" }, HERE)).toBe("https://example.test/");
  });

  it.each([
    ["a click that is not on a link", { href: null }],
    ["a right or middle click", { button: 1 }],
    ["a click with a modifier, which opens a new tab", { modified: true }],
    ["a link opening a new tab", { target: "_blank" }],
    ["a download", { download: true }],
    ["a click something already handled", { defaultPrevented: true }],
    ["a mail link", { href: "mailto:a@example.test" }],
    ["a link to a place on this page", { href: `${HERE}#leadership` }],
  ])("lets %s through", (_name, override) => {
    expect(leavingHref({ ...click, ...override }, HERE)).toBeNull();
  });
});

describe("useLeaveGuard", () => {
  let guard: ReturnType<typeof useLeaveGuard>;
  let root: Root;
  let container: HTMLElement;
  let link: HTMLAnchorElement;
  let go: ReturnType<typeof vi.spyOn>;

  function Harness({ dirty }: { dirty: boolean }) {
    guard = useLeaveGuard(dirty);
    return null;
  }
  const render = (dirty: boolean) => act(() => root.render(createElement(Harness, { dirty })));
  const pressBack = () => act(() => void window.dispatchEvent(new PopStateEvent("popstate")));

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    go = vi.spyOn(window.history, "go").mockImplementation(() => {});
    vi.spyOn(window.history, "back").mockImplementation(() => {});
    container = document.createElement("div");
    document.body.appendChild(container);
    link = document.createElement("a");
    link.href = "/elsewhere";
    document.body.appendChild(link);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    link.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("asks about Back, and goes past its spare history entry on Leave", () => {
    render(true);
    pressBack();
    expect(guard.asking).toBe(true);
    act(() => guard.leave());
    expect(guard.asking).toBe(false);
    expect(go).toHaveBeenCalledWith(-2);
  });

  it("lets the traversal Leave started through without asking again", () => {
    render(true);
    pressBack();
    act(() => guard.leave());
    pressBack();
    expect(guard.asking).toBe(false);
  });

  it("keeps asking after a Leave on Back that had nowhere to go", () => {
    render(true);
    pressBack();
    act(() => guard.leave());
    act(() => void vi.runAllTimers());

    pressBack();
    expect(guard.asking).toBe(true);
    act(() => guard.stay());

    act(() => link.click());
    expect(guard.asking).toBe(true);
    expect(push).not.toHaveBeenCalled();

    const reload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(reload);
    expect(reload.defaultPrevented).toBe(true);
  });

  it("drops the question when a Save finishes while it is open, and does not raise it later", () => {
    render(true);
    pressBack();
    expect(guard.asking).toBe(true);
    render(false);
    expect(guard.asking).toBe(false);
    render(true);
    expect(guard.asking).toBe(false);
  });
});
