import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import NotFound from "./not-found";

describe("NotFound", () => {
  it("renders a page heading and a way home", () => {
    const html = renderToStaticMarkup(createElement(NotFound));
    expect(html).toMatch(/<h1 [^>]*>Page not found<\/h1>/);
    expect(html).toMatch(/<a [^>]*href="\/"[^>]*>Go to Home<\/a>/);
  });
});
