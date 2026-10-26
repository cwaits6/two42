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
const { LANDING_SECTIONS } = await import("@/components/landing/sections");

const member = { id: "user-1", role: "member" } as Profile;

function render(profile: Profile | null) {
  return renderToStaticMarkup(
    createElement(Header, { profile, hasServingAccess: false, orgName: "Org" }),
  );
}

beforeEach(() => {
  pathname = "/";
});

describe("Header signed out", () => {
  it("links to every landing section from the front door", () => {
    const html = render(null);
    expect(html).toContain('aria-label="Page sections"');
    for (const section of LANDING_SECTIONS) {
      expect(html).toContain(`href="#${section.id}"`);
    }
    expect(html).toContain('href="/login"');
  });

  it("drops the section links on every other route", () => {
    pathname = "/privacy";
    const html = render(null);
    expect(html).not.toContain('aria-label="Page sections"');
    expect(html).not.toContain('href="#');
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
  it("shows no section links or sign-in on the front door", () => {
    const html = render(member);
    expect(html).not.toContain('aria-label="Page sections"');
    expect(html).not.toContain('href="/login"');
    expect(html).toContain("Sign Out");
  });
});
