import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PrivacyPage from "@/app/privacy/page";
import TermsPage from "@/app/terms/page";
import { formatLastUpdated, inlineParts } from "./document";
import { BASECAMP_POLICIES_URL, CC_BY_URL } from "./LegalPage";
import { PRIVACY, PROCESSORS } from "./privacy";
import { TERMS } from "./terms";

const pages = [
  { name: "privacy", html: renderToStaticMarkup(createElement(PrivacyPage)), doc: PRIVACY, companion: "/terms" },
  { name: "terms", html: renderToStaticMarkup(createElement(TermsPage)), doc: TERMS, companion: "/privacy" },
];

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const privacyText = text(pages[0].html);

describe.each(pages)("the $name page", ({ html, doc, companion }) => {
  it("is a finished document, not a placeholder", () => {
    expect(html).not.toMatch(/being written/i);
  });

  it("shows its Last updated date", () => {
    expect(html).toContain(`Last updated ${formatLastUpdated(doc.lastUpdated)}`);
  });

  it("links to the other document and credits the source it was adapted from", () => {
    expect(html).toContain(`href="${companion}"`);
    expect(text(html)).toContain("Adapted from the Basecamp open-source policies / CC BY 4.0");
    expect(html).toContain(`href="${BASECAMP_POLICIES_URL}"`);
    expect(html).toContain(`href="${CC_BY_URL}"`);
  });

  // Page patterns such as /g/[groupId] are bracketed too, but never hold a space.
  it("leaves no bracketed placeholder on the public page", () => {
    expect(text(html)).not.toMatch(/\[[^\]]*\s[^\]]*\]/);
  });
});

describe("the privacy policy", () => {
  it.each(["Supabase", "Vercel", "Web Analytics", "Resend", "Google Maps", "YouTube"])("names %s", (name) => {
    expect(privacyText).toContain(name);
  });

  it("names every processor in its processors list", () => {
    for (const processor of PROCESSORS) expect(privacyText).toContain(`${processor.name}:`);
  });

  it("gives the privacy contact address", () => {
    expect(pages[0].html).toContain('href="mailto:privacy@two42.io"');
  });
});

describe("inlineParts", () => {
  it("splits a link out of the text around it", () => {
    expect(inlineParts("See [the terms](/terms) first.")).toEqual([
      { text: "See " },
      { text: "the terms", href: "/terms" },
      { text: " first." },
    ]);
  });
});

describe("formatLastUpdated", () => {
  it("reads the date as written, without a time zone shift", () => {
    expect(formatLastUpdated("2026-01-01")).toBe("January 1, 2026");
  });

  it("refuses a date in any other form", () => {
    expect(() => formatLastUpdated("Nov 13 2026")).toThrow();
  });
});
