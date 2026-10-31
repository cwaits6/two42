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
  useSidebarModel: () => ({ phonePill: null }),
}));
vi.mock("@/components/layout/SidebarNav", () => ({ SidebarNav: () => null }));

const { Header } = await import("./Header");

const member = { id: "user-1", role: "member" } as Profile;

function render(profile: Profile | null, signedIn = profile !== null) {
  return renderToStaticMarkup(
    createElement(Header, { signedIn, profile, hasServingAccess: false, orgName: "Org" }),
  );
}

beforeEach(() => {
  pathname = "/";
});

describe("Header signed out", () => {
  it("offers only the wordmark and sign-in on the front door", () => {
    const html = render(null);
    expect(html).toContain("two42-wordmark.svg");
    expect(html).toContain('href="/login"');
    expect(html).not.toContain('href="#');
    expect(html).not.toContain("Sign Out");
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
  it("shows no sign-in on the front door", () => {
    const html = render(member);
    expect(html).not.toContain('href="/login"');
    expect(html).toContain("Sign Out");
  });
});

describe("Header signed in with no profile", () => {
  it("shows sign-out, not sign-in, on the platform pages", () => {
    pathname = "/platform";
    const html = render(null, true);
    expect(html).toContain("Sign Out");
    expect(html).not.toContain('href="/login"');
  });

  it("shows sign-out on every other route without the member menu", () => {
    pathname = "/privacy";
    const html = render(null, true);
    expect(html).toContain("Sign Out");
    expect(html).not.toContain('href="/login"');
    expect(html).not.toContain("navigation menu");
  });
});
