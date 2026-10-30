import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PageContainer } from "./PageContainer";

function classesFor(size?: "reading" | "default" | "wide"): string[] {
  const html = renderToStaticMarkup(createElement(PageContainer, { size }, "content"));
  return (html.match(/class="([^"]*)"/)?.[1] ?? "").split(" ");
}

describe("PageContainer", () => {
  it.each([
    ["reading", "max-w-2xl"],
    ["default", "max-w-4xl"],
    ["wide", "max-w-6xl"],
  ] as const)("caps the %s width at %s", (size, maxWidth) => {
    expect(classesFor(size)).toContain(maxWidth);
  });

  it("uses the default width when none is named", () => {
    expect(classesFor()).toEqual(classesFor("default"));
  });

  it("keeps one gutter and one vertical rhythm at every width", () => {
    const frame = (size: "reading" | "default" | "wide") =>
      classesFor(size).filter((c) => !c.startsWith("max-w-"));
    expect(frame("reading")).toEqual(frame("default"));
    expect(frame("wide")).toEqual(frame("default"));
    expect(frame("default")).toEqual(
      expect.arrayContaining(["mx-auto", "px-4", "sm:px-6", "lg:px-8", "py-12"]),
    );
  });
});
