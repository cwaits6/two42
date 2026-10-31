import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Profile } from "@/lib/types";

let pathname = "/";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: {} }) }));
vi.mock("@/components/layout/useSidebarModel", () => ({
  useSidebarModel: () => ({ items: [], showCollapseControl: false, collapsed: false }),
}));
vi.mock("@/components/layout/SidebarNav", () => ({ SidebarNav: () => null }));

const { Header } = await import("./Header");
const { AccountMenuPanel } = await import("./AccountMenu");

const member = { id: "user-1", role: "member" } as Profile;
const admin = { id: "user-2", role: "admin" } as Profile;

function render(profile: Profile | null, signedIn = profile !== null) {
  return renderToStaticMarkup(
    createElement(Header, { signedIn, profile, hasServingAccess: false, orgName: "Org" }),
  );
}

function panel(profile: Profile | null, isPlatformAdmin = false) {
  return renderToStaticMarkup(
    createElement(AccountMenuPanel, {
      profile,
      hasServingAccess: false,
      isPlatformAdmin,
      orgName: "Org",
      onNavigate: () => {},
      onSignOut: () => {},
    }),
  );
}

const menuButton = /<button[^>]*>.*?Menu<\/button>/;

beforeEach(() => {
  pathname = "/";
});

describe("Header signed out", () => {
  it("offers only the wordmark and sign-in on the front door", () => {
    const html = render(null);
    expect(html).toContain("two42-wordmark.svg");
    expect(html).toContain('href="/login"');
    expect(html).not.toContain('href="#');
    expect(html).not.toMatch(menuButton);
  });

  it("keeps sign-in on every other route", () => {
    pathname = "/privacy";
    const html = render(null);
    expect(html).toContain('href="/login"');
  });

  it("drops the sign-in button on the sign-in page itself", () => {
    pathname = "/login";
    const html = render(null);
    expect(html).not.toContain('href="/login"');
    expect(html).toContain("two42-wordmark.svg");
  });
});

describe("Header signed in", () => {
  it.each([
    ["a member in a group", member, `/g/c0000000-0000-0000-0000-00000000000b/dashboard`],
    ["a member at Home", member, "/dashboard"],
    ["a church admin in the admin area", admin, "/admin/members"],
    ["a platform admin with no church profile", null, "/platform"],
    ["anyone on a public page", member, "/privacy"],
  ])("gives %s the wordmark and the menu, and no sign-in", (_who, profile, path) => {
    pathname = path;
    const html = render(profile, true);
    expect(html).toContain("two42-wordmark.svg");
    expect(html).toMatch(menuButton);
    expect(html).not.toContain('href="/login"');
    expect(html).not.toContain("Sign out");
    expect(html).not.toContain("Switch group");
  });
});

describe("AccountMenuPanel", () => {
  it("ends with Privacy, Terms, Help and one Sign out for a member", () => {
    pathname = "/dashboard";
    const html = panel(member);
    expect(html).toContain('aria-label="Main navigation"');
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/terms"');
    expect(html).toContain('href="mailto:hello@two42.io"');
    expect(html.match(/Sign out/g)).toHaveLength(1);
    expect(html).not.toContain("Sign Out");
    expect(html).not.toContain('href="/platform"');
  });

  it("swaps the member nav for the admin nav in the admin area", () => {
    pathname = "/admin/members";
    const html = panel(admin);
    expect(html).toContain('aria-label="Admin navigation"');
    expect(html).not.toContain('aria-label="Main navigation"');
    expect(html).toContain('href="/admin/families"');
    expect(html).toContain("Back to Home");
  });

  it("gives a platform admin with no church profile the platform nav and Sign out", () => {
    pathname = "/platform";
    const html = panel(null, true);
    expect(html).toContain('aria-label="Platform navigation"');
    expect(html).toContain('href="/platform/organizations"');
    expect(html).toContain("Sign out");
  });

  it("gives a signed-in person with no church profile Sign out on any page", () => {
    pathname = "/privacy";
    const html = panel(null, true);
    expect(html).not.toContain('aria-label="Main navigation"');
    expect(html).toContain('href="/platform"');
    expect(html).toContain("Sign out");
  });
});
