import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LoadingState, PageLoading } from "./LoadingState";

describe("LoadingState", () => {
  it("announces what is loading once and hides the skeleton from screen readers", () => {
    const html = renderToStaticMarkup(createElement(LoadingState, { thing: "the calendar" }));
    expect(html.match(/role="status"/g)).toHaveLength(1);
    expect(html).toContain('<p role="status" class="sr-only">Loading the calendar</p>');
    expect(html).toMatch(/<div class="[^"]*" aria-hidden="true">/);
  });

  it("draws the number of skeleton rows asked for", () => {
    const html = renderToStaticMarkup(createElement(LoadingState, { thing: "x", rows: 3 }));
    expect(html.match(/rounded-full bg-muted animate-pulse/g)).toHaveLength(3);
  });
});

describe("PageLoading", () => {
  it("keeps the page's real header while the content loads", () => {
    const html = renderToStaticMarkup(
      createElement(PageLoading, { title: "Calendar", thing: "the calendar", size: "wide" }),
    );
    expect(html).toMatch(/^<div class="[^"]*\bmax-w-6xl\b/);
    expect(html).toMatch(/<h1 [^>]*>Calendar<\/h1>/);
    expect(html.indexOf("</header>")).toBeLessThan(html.indexOf('role="status"'));
  });

  it("holds the title's place without inventing a title when it depends on the data", () => {
    const html = renderToStaticMarkup(createElement(PageLoading, { thing: "Home" }));
    expect(html).not.toContain("<h1");
    expect(html).toMatch(/^<div class="[^"]*"><div class="mb-8" aria-hidden="true">/);
    expect(html).toContain("Loading Home");
  });
});
