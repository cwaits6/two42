import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CONTACT_EMAIL, GITHUB_URL } from "./sections";
import { PolicyPlaceholder } from "./PolicyPlaceholder";

const html = renderToStaticMarkup(
  createElement(PolicyPlaceholder, {
    title: "Privacy",
    summary: "What the page covers.",
    status: "The full policy is being written.",
  }),
);
const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);

describe("PolicyPlaceholder", () => {
  it("links home, to the contact address and to the source, nothing else", () => {
    expect(hrefs).toEqual(["/", `mailto:${CONTACT_EMAIL}`, GITHUB_URL]);
  });

  it("names the page and says the document is still being written", () => {
    expect(html).toMatch(/<h1[^>]*>Privacy<\/h1>/);
    expect(html).toContain("What the page covers.");
    expect(html).toContain("The full policy is being written.");
  });
});
