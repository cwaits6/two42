import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { buildAccount, type Account } from "./account";

let pathname = "/";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("./useSidebarModel", () => ({
  useSidebarModel: () => [{ kind: "link", href: "/dashboard", label: "Home", icon: "home" }],
}));

const { FrameNav } = await import("./FrameNav");
const { SidebarProvider } = await import("./SidebarContext");
type ProviderProps = Parameters<typeof SidebarProvider>[0];

const name = { first_name: "Isaac", last_name: "Seedly", preferred_name: null };
const base = { email: "isaac@example.test", isOperator: false, photoUrl: null };
const member = buildAccount({ ...base, profile: { ...name, role: "member" } });
const admin = buildAccount({ ...base, profile: { ...name, role: "admin" } });
const pending = buildAccount({ ...base, profile: { ...name, role: "pending" } });
const operator = buildAccount({ ...base, profile: null, isOperator: true });

function render(account: Account, path: string, waitingRequests: number | null = null) {
  pathname = path;
  const nav = createElement(FrameNav, { account });
  return renderToStaticMarkup(
    createElement(
      SidebarProvider,
      { account, hasServingAccess: false, orgName: "Test Church", waitingRequests } as ProviderProps,
      nav,
    ),
  );
}

const links = (html: string) => [...html.matchAll(/<a [^>]*href="(\/admin[^"]*)"/g)].map((m) => m[1]);

const navs = (html: string) => [...html.matchAll(/<nav aria-label="([^"]+)"/g)].map((m) => m[1]);

describe("FrameNav", () => {
  it("gives a member their own pages", () => {
    const html = render(member, "/dashboard");
    expect(navs(html)).toEqual(["Main navigation"]);
    expect(html).toContain('href="/dashboard"');
  });

  it("gives a church admin the church admin pages under /admin, and their own elsewhere", () => {
    const html = render(admin, "/admin/members");
    expect(navs(html)).toEqual(["Admin navigation"]);
    expect(html).toContain("Back to Home");
    expect(navs(render(admin, "/dashboard"))).toEqual(["Main navigation"]);
  });

  it("lists the church admin pages with no Overview", () => {
    expect(links(render(admin, "/admin/members"))).toEqual([
      "/admin/members",
      "/admin/families",
      "/admin/groups",
      "/admin/requests",
      "/admin/settings",
    ]);
  });

  it("shows the number waiting on Requests, and none at zero or when it couldn't be counted", () => {
    const requests = (html: string) => html.match(/<a [^>]*href="\/admin\/requests"[^>]*>(.*?)<\/a>/)![1];
    expect(requests(render(admin, "/admin/members", 3))).toContain(">3</span>");
    expect(requests(render(admin, "/admin/members", 3))).toContain(", 3 waiting");
    for (const none of [0, null]) {
      expect(requests(render(admin, "/admin/members", none))).not.toMatch(/waiting|>\d+<\/span>/);
    }
  });

  it("never gives a member the church admin or Platform pages, whatever the path", () => {
    for (const path of ["/admin", "/admin/members", "/platform", "/platform/organizations"]) {
      const html = render(member, path);
      expect(navs(html), path).toEqual(["Main navigation"]);
      expect(html).not.toContain('href="/admin');
      expect(html).not.toContain('href="/platform');
    }
  });

  it("gives an operator the Platform pages under /platform only", () => {
    const html = render(operator, "/platform");
    expect(navs(html)).toEqual(["Platform navigation"]);
    expect(html).toContain('href="/platform/organizations"');
    expect(navs(render(operator, "/admin"))).toEqual([]);
  });

  it("gives a pending person and an operator outside Platform no pages", () => {
    expect(render(pending, "/dashboard")).toBe("");
    expect(render(pending, "/admin")).toBe("");
    expect(render(operator, "/dashboard")).toBe("");
  });
});
