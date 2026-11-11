import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LandingPage } from "./LandingPage";
import { CONTACT_EMAIL, GITHUB_URL } from "./sections";

const html = renderToStaticMarkup(createElement(LandingPage));
const hrefs = [...html.matchAll(/<a [^>]*href="([^"]*)"/g)].map((m) => m[1]);

describe("LandingPage", () => {
  it("navigates only to the contact address and GitHub", () => {
    expect(hrefs).toContain(`mailto:${CONTACT_EMAIL}`);
    for (const href of hrefs) {
      const allowed = href === `mailto:${CONTACT_EMAIL}` || href.startsWith(`${GITHUB_URL}`);
      expect(allowed, `unexpected link ${href}`).toBe(true);
    }
  });

  it("keeps the serving copy exact and offers no join request", () => {
    expect(html).toContain(
      "Each team’s coming dates in one list. Members pick the ones they can take, and leaders see what’s still uncovered at a glance.",
    );
    expect(html).not.toMatch(/request to join/i);
  });

  it("keeps the approved eyebrow and headline", () => {
    expect(html).toContain("For churches and their groups");
    expect(html).toMatch(/<h1[^>]*>Run your church’s groups <span[^>]*>in one place\.<\/span><\/h1>/);
  });

  it("names the menu's pages in the hero window as the app does", () => {
    for (const label of ["Home", "Calendar", "Announcements", "Prayer", "Lessons", "Serving", "Directory", "Give"]) {
      expect(html, label).toMatch(new RegExp(`<li[^>]*>(<svg[\\s\\S]*?</svg>)?${label}(<span|</li>)`));
    }
    expect(html).toContain("Good evening, <span>David</span>.");
  });

  it("implies no install, public sign-up or price", () => {
    expect(html).not.toMatch(/download|install|app store|sign up|get started|pricing|per month|\$\d/i);
  });

  it("serves a phone-width capture of every screenshot below the md breakpoint", () => {
    const pictures = [...html.matchAll(/<picture[\s\S]*?<\/picture>/g)].map((m) => m[0]);
    expect(pictures.length).toBe(7);
    for (const picture of pictures) {
      expect(picture).toMatch(/<source media="\(min-width: 768px\)"/);
      expect(picture).toMatch(/<source srcSet="[^"]*-phone\.png/);
    }
  });
});
