// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SubscribeDialog, feedLinks, type SubscribeState } from "@/components/events/SubscribeDialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("feedLinks", () => {
  it("builds the https feed, its webcal twin, and Google's add-by-URL link to the webcal feed", () => {
    const links = feedLinks("https://two42.io", "tok123", "g-1");
    expect(links.https).toBe("https://two42.io/api/calendar/feed.ics?token=tok123&group=g-1");
    expect(links.webcal).toBe("webcal://two42.io/api/calendar/feed.ics?token=tok123&group=g-1");
    expect(links.google).toBe(
      "https://calendar.google.com/calendar/r?cid=" +
        encodeURIComponent("webcal://two42.io/api/calendar/feed.ics?token=tok123&group=g-1")
    );
  });

  it("leaves the group out for every group", () => {
    expect(feedLinks("https://two42.io", "tok123").https).toBe(
      "https://two42.io/api/calendar/feed.ics?token=tok123"
    );
  });
});

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

function render(state: SubscribeState) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(createElement(SubscribeDialog, { feedName: "Hillside", state, onClose: () => {} })));
}

const button = (name: string) =>
  [...document.querySelectorAll<HTMLElement>("a, button")].find((el) => el.textContent?.trim() === name);

describe("SubscribeDialog", () => {
  it("offers Apple, Google and Copy link once the link is ready", () => {
    const links = feedLinks("https://two42.io", "tok123", "g-1");
    render({ status: "ready", links });
    expect(document.body.textContent).toContain("Subscribe to Hillside");
    expect(button("Open in Apple Calendar")?.getAttribute("href")).toBe(links.webcal);
    expect(button("Add to Google Calendar")?.getAttribute("href")).toBe(links.google);
    expect(button("Copy link")).toBeTruthy();
  });

  it("copies the https feed and confirms it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const links = feedLinks("https://two42.io", "tok123");
    render({ status: "ready", links });
    await act(async () => button("Copy link")!.click());
    expect(writeText).toHaveBeenCalledWith(links.https);
    expect(button("Link copied")).toBeTruthy();
  });

  it("shows the link to select by hand when copying is refused", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const links = feedLinks("https://two42.io", "tok123");
    render({ status: "ready", links });
    await act(async () => button("Copy link")!.click());
    expect(document.querySelector<HTMLInputElement>('input[aria-label="Calendar link"]')?.value).toBe(links.https);
  });

  it("says when the link could not be made", () => {
    render({ status: "failed", message: "We couldn't create your calendar link." });
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("We couldn't create your calendar link.");
    expect(button("Copy link")).toBeUndefined();
  });
});
