import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildAccount, type Account } from "./account";

let pathname = "/";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: {} }) }));

let account: Account | null = null;
vi.mock("./SidebarContext", () => ({ useSidebar: () => ({ account }) }));

const { Header } = await import("./Header");

const name = { first_name: "Isaac", last_name: "Seedly", preferred_name: null };
const base = { email: "isaac@example.test", isOperator: false, photoUrl: null };
const member = buildAccount({ ...base, profile: { ...name, role: "member" } });
const admin = buildAccount({ ...base, profile: { ...name, role: "admin" } });
const pending = buildAccount({ ...base, profile: { ...name, role: "pending" } });
const operator = buildAccount({ ...base, profile: null, isOperator: true });

function render(who: Account | null) {
  account = who;
  return renderToStaticMarkup(createElement(Header));
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
    expect(html).not.toContain("md:hidden");
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
    ["a church admin on a church admin page", admin, "/admin/members"],
    ["an operator with no church", operator, "/platform"],
    ["a pending person", pending, "/dashboard"],
    ["anyone on a public page", member, "/privacy"],
  ])("gives %s the wordmark and one Menu button, and no sign-in", (_who, who, path) => {
    pathname = path;
    const html = render(who);
    expect(html).toContain("two42-wordmark.svg");
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toMatch(menuButton);
    expect(html).not.toContain('href="/login"');
    expect(html).not.toContain("Sign out");
    expect(html).not.toContain("Switch group");
  });

  it("is the phone frame only: the sidebar takes over from md up", () => {
    expect(render(member)).toMatch(/<header[^>]*md:hidden/);
  });

  it("sends the wordmark to Home for a member and to the front door for anyone else", () => {
    expect(render(member)).toMatch(/<a[^>]*href="\/dashboard"[^>]*><img[^>]*two42-wordmark/);
    expect(render(pending)).toMatch(/<a[^>]*href="\/"[^>]*><img[^>]*two42-wordmark/);
  });
});
