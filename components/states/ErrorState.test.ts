import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

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

  it("never reads as an empty list", () => {
    expect(render()).not.toMatch(/\byet\b/i);
  });
});
