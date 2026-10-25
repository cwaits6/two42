import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CONTACT_EMAIL, GITHUB_URL, SELF_HOST_URL } from "@/components/landing/sections";
import { Footer } from "./Footer";

const html = renderToStaticMarkup(createElement(Footer));
const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);

describe("Footer", () => {
  it("links to GitHub, the self-host guide, Privacy, Terms and the contact address, nothing else", () => {
    expect(hrefs).toEqual([GITHUB_URL, SELF_HOST_URL, "/privacy", "/terms", `mailto:${CONTACT_EMAIL}`]);
  });

  it("carries the wordmark and the current year", () => {
    expect(html).toMatch(/two<span[^>]*>42<\/span>/);
    expect(html).toContain(`© ${new Date().getFullYear()} two42`);
  });
});
