// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const { ErrorState } = await import("./ErrorState");

function render() {
  return renderToStaticMarkup(createElement(ErrorState, { thing: "announcements" }));
}

describe("ErrorState", () => {
  it("names what failed and offers to try again", () => {
    const html = render();
    expect(html).toContain("Couldn&#x27;t load announcements.");
    expect(html).toMatch(/<button[^>]*>.*Try again<\/button>/);
  });

  it("is announced as an alert, in a solid box rather than the empty state's dashed one", () => {
    const html = render();
    expect(html).toMatch(/^<div role="alert" class="[^"]*\bborder-destructive\/30\b/);
    expect(html).not.toContain("border-dashed");
  });

  it("retries with onRetry instead of a server refresh when given one", async () => {
    const onRetry = vi.fn();
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(createElement(ErrorState, { thing: "the directory", onRetry })));
    await act(async () => container.querySelector("button")!.click());
    expect(onRetry).toHaveBeenCalledOnce();
    expect(refresh).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it("never reads as an empty list", () => {
    expect(render()).not.toMatch(/\byet\b/i);
  });
});
