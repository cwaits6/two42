import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ActiveGroup } from "@/lib/groups/active";
import { GROUP_DEFAULT_COLOR } from "@/lib/groups/calendar";
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
const { areaFor } = await import("./AreaNav");
const { SidebarProvider } = await import("./SidebarContext");
const { GroupProvider } = await import("@/components/groups/GroupProvider");
type ProviderProps = Parameters<typeof SidebarProvider>[0];

const name = { first_name: "Isaac", last_name: "Seedly", preferred_name: null };
const base = { email: "isaac@example.test", isOperator: false, photoUrl: null };
const member = buildAccount({ ...base, profile: { ...name, role: "member" } });
const admin = buildAccount({ ...base, profile: { ...name, role: "admin" } });
const pending = buildAccount({ ...base, profile: { ...name, role: "pending" } });
const operator = buildAccount({ ...base, profile: null, isOperator: true });

function render(
  account: Account,
  path: string,
  waitingRequests: number | null = null,
  groups: { memberships?: ActiveGroup[]; groupWaitingRequests?: Record<string, number> } = {},
) {
  pathname = path;
  const nav = createElement(FrameNav, { account });
  return renderToStaticMarkup(
    createElement(
      GroupProvider,
      {
        memberships: groups.memberships ?? [],
        discoveryOn: false,
        creation: { policy: "approval", isOrgAdmin: false },
      } as Parameters<typeof GroupProvider>[0],
      createElement(
        SidebarProvider,
        {
          account,
          hasServingAccess: false,
          orgName: "Test Church",
          waitingRequests,
          groupWaitingRequests: groups.groupWaitingRequests,
        } as ProviderProps,
        nav,
      ),
    ),
  );
}

const GRACE = "11111111-1111-4111-8111-111111111111";
const HOPE = "22222222-2222-4222-8222-222222222222";
const grace: ActiveGroup = { id: GRACE, name: "Grace", color: GROUP_DEFAULT_COLOR, role: "leader" };
const hope: ActiveGroup = { id: HOPE, name: "Hope", color: GROUP_DEFAULT_COLOR, role: "leader" };
const graceAsMember: ActiveGroup = { ...grace, role: "member" };

/** Every link in the rendered nav: its href and its text as a screen reader reads it. */
const namedLinks = (html: string) =>
  [...html.matchAll(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/g)].map((m) => [
    m[1],
    m[2].replace(/<span aria-hidden="true"[^>]*>.*?<\/span>/g, "").replace(/<[^>]+>/g, ""),
  ]);

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

  it("gives a group's leader the Group settings sections under its settings, led by the way back to the group", () => {
    for (const path of [`/g/${GRACE}/settings`, `/g/${GRACE}/settings/teams`]) {
      const html = render(member, path, null, { memberships: [grace] });
      expect(navs(html), path).toEqual(["Group settings navigation"]);
      expect(namedLinks(html), path).toEqual([
        [`/g/${GRACE}/dashboard`, "Back to Grace"],
        [`/g/${GRACE}/settings/details`, "Details"],
        [`/g/${GRACE}/settings/requests`, "Requests"],
        [`/g/${GRACE}/settings/privacy`, "Privacy and joining"],
        [`/g/${GRACE}/settings/invites`, "Invite links"],
        [`/g/${GRACE}/settings/teams`, "Teams"],
        [`/g/${GRACE}/settings/labels`, "Labels"],
      ]);
    }
  });

  it("shows the group's waiting count on Requests, and none at zero or when it couldn't be counted", () => {
    const requests = (counts: Record<string, number>) =>
      namedLinks(render(member, `/g/${GRACE}/settings/details`, null, { memberships: [grace], groupWaitingRequests: counts }))
        .find(([href]) => href.endsWith("/settings/requests"))![1];
    expect(requests({ [GRACE]: 3 })).toBe("Requests, 3 waiting");
    expect(requests({ [GRACE]: 0 })).toBe("Requests");
    expect(requests({})).toBe("Requests");
  });

  it("shows a leader of two groups the count of the group they are in", () => {
    const counts = { [GRACE]: 1, [HOPE]: 4 };
    const requestsIn = (id: string) =>
      namedLinks(render(member, `/g/${id}/settings/requests`, 9, { memberships: [grace, hope], groupWaitingRequests: counts }))
        .find(([href]) => href.endsWith("/settings/requests"))!;
    expect(requestsIn(GRACE)).toEqual([`/g/${GRACE}/settings/requests`, "Requests, 1 waiting"]);
    expect(requestsIn(HOPE)).toEqual([`/g/${HOPE}/settings/requests`, "Requests, 4 waiting"]);
  });

  it("never gives a member of the group, or someone outside it, the Group settings sections", () => {
    for (const memberships of [[graceAsMember], [hope]]) {
      const html = render(member, `/g/${GRACE}/settings/requests`, null, {
        memberships,
        groupWaitingRequests: { [GRACE]: 2 },
      });
      expect(navs(html)).toEqual(["Main navigation"]);
      expect(html).not.toContain("/settings/requests");
      expect(html).not.toContain("waiting");
    }
  });

  it("gives a church admin who does not lead the group no Group settings sections", () => {
    expect(navs(render(admin, `/g/${GRACE}/settings`, 3, { memberships: [] }))).toEqual(["Main navigation"]);
  });
});

describe("areaFor", () => {
  it.each([
    ["/g/x/settings", "groupSettings"],
    ["/g/x/settings/teams", "groupSettings"],
    ["/g/x/settingsx", null],
    ["/g/x/dashboard", null],
    ["/settings", null],
    ["/admin/requests", "admin"],
  ])("%s is %s", (path, area) => {
    expect(areaFor(path)).toBe(area);
  });
});
