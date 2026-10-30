import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CardContent } from "./card";

function contentClasses(className?: string): string[] {
  const html = renderToStaticMarkup(createElement(CardContent, { className }, "body"));
  return (html.match(/class="([^"]*)"/)?.[1] ?? "").split(" ");
}

describe("CardContent vertical inset", () => {
  it("drops its own padding at the card's top and bottom edges", () => {
    expect(contentClasses()).toEqual(expect.arrayContaining(["first:pt-0", "last:pb-0"]));
  });

  // The edge rules outrank a plain padding utility, so a caller's leftover
  // top padding cannot make a headerless card deeper at the top.
  it("keeps the edge rules when a caller pads the content", () => {
    expect(contentClasses("pt-6")).toEqual(expect.arrayContaining(["first:pt-0", "last:pb-0"]));
  });
});
