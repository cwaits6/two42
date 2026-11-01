import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LandingPage } from "./LandingPage";
import { CONTACT_EMAIL, GITHUB_URL } from "./sections";

const html = renderToStaticMarkup(createElement(LandingPage));
const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
const ids = new Set([...html.matchAll(/ id="([^"]*)"/g)].map((m) => m[1]));

describe("LandingPage", () => {
  it("resolves every in-page anchor to a rendered id", () => {
    const anchors = hrefs.filter((h) => h.startsWith("#"));
    expect(anchors.length).toBeGreaterThan(0);
    for (const anchor of anchors) {
      expect(ids.has(anchor.slice(1)), `dead anchor ${anchor}`).toBe(true);
    }
  });

  it("navigates only to sign-in, the contact address, GitHub and in-page anchors", () => {
    expect(hrefs).toContain("/login");
    expect(hrefs).toContain(`mailto:${CONTACT_EMAIL}`);
    for (const href of hrefs) {
      const allowed =
        href === "/login" ||
        href === `mailto:${CONTACT_EMAIL}` ||
        href.startsWith(`${GITHUB_URL}`) ||
        href.startsWith("#");
      expect(allowed, `unexpected link ${href}`).toBe(true);
    }
  });

  it("keeps the serving copy exact and offers no join request", () => {
    expect(html).toContain(
      "Each team’s coming dates in one list. Members pick the ones they can take, and leaders see what’s still uncovered at a glance.",
    );
    expect(html).not.toMatch(/request to join/i);
  });

  it("gives someone with an invite link a path from the hero", () => {
    expect(hrefs).toContain("#invite");
    expect(html).toMatch(/<h2[^>]*>Have an invite link\?<\/h2>/);
  });

  it("serves a phone-width capture of every screenshot below the md breakpoint", () => {
    const pictures = [...html.matchAll(/<picture[\s\S]*?<\/picture>/g)].map((m) => m[0]);
    expect(pictures.length).toBe(5);
    for (const picture of pictures) {
      expect(picture).toMatch(/<source media="\(min-width: 768px\)"/);
      expect(picture).toMatch(/<source srcSet="[^"]*-phone\.png/);
    }
  });
});
