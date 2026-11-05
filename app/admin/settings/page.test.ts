import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";

class RedirectSentinel extends Error {
  constructor(public readonly target: string) {
    super(`redirect:${target}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (target: string) => {
    throw new RedirectSentinel(target);
  },
}));

const ORG_ID = "org-1";

// Named stand-ins, so a test can read the value a control was handed.
const { GroupDiscoverySettings, OrgGroupControls, GivingSettings, TimezoneSettings } = vi.hoisted(() => ({
  GroupDiscoverySettings: () => null,
  OrgGroupControls: () => null,
  GivingSettings: () => null,
  TimezoneSettings: () => null,
}));

vi.mock("@/lib/supabase/current-user", () => ({
  getOptionalUser: async () => ({ id: "user-1", email: undefined }),
}));

type Read = { data: Record<string, unknown> | null; error: { code: string } | null };
const RULES = { group_discovery: true, group_creation_policy: "open", timezone: "America/Chicago" };
const reads = vi.hoisted(() => ({
  organizations: null as unknown as Read,
  site_settings: null as unknown as Read,
}));

// The page never reads organizations.custom_email_domain_enabled: the flag,
// not the column, decides whether the tile renders.
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: "profiles" | "organizations" | "site_settings") => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        single: async () => ({ data: { role: "admin", org_id: ORG_ID } }),
        maybeSingle: async () => reads[table as "organizations"],
      };
      return chain;
    },
  }),
}));

vi.mock("@/lib/directory/visibility", () => ({
  getDirectoryVisibility: async () => "shared_groups",
}));
vi.mock("@/components/admin/DirectoryVisibilitySettings", () => ({
  DirectoryVisibilitySettings: () => null,
}));
vi.mock("@/components/giving/GivingSettings", () => ({ GivingSettings }));
vi.mock("@/lib/orgPrayerRetention", () => ({
  getPrayerRetention: async () => prayerRetention.current,
}));
vi.mock("@/components/admin/PrayerRetentionSettings", () => ({
  PrayerRetentionSettings: () => null,
}));

vi.mock("@/components/groups/GroupDiscoverySettings", () => ({ GroupDiscoverySettings }));
vi.mock("@/components/admin/OrgGroupControls", () => ({ OrgGroupControls }));
vi.mock("@/components/admin/TimezoneSettings", () => ({ TimezoneSettings }));

const prayerRetention = vi.hoisted(() => ({ current: "off" as "off" | null }));
const sendingDomains = vi.hoisted(() => ({
  CUSTOM_SENDING_DOMAINS_ENABLED: false,
}));
vi.mock("@/lib/email/sendingDomains", () => sendingDomains);

const { ChurchSettings } = await import("./ChurchSettings");

function walk(
  node: ReactNode,
  hrefs: string[],
  texts: string[],
  things: unknown[] = [],
  controls: Map<unknown, Record<string, unknown>> = new Map()
): void {
  if (Array.isArray(node)) {
    node.forEach((n) => walk(n, hrefs, texts, things, controls));
    return;
  }
  if (typeof node === "string") {
    texts.push(node);
    return;
  }
  if (!node || typeof node !== "object" || !("props" in node)) return;
  const element = node as ReactElement<{
    href?: string;
    render?: ReactNode;
    children?: ReactNode;
    thing?: string;
  }>;
  if (typeof element.props.href === "string") hrefs.push(element.props.href);
  if (element.props.thing) things.push(element.props.thing);
  if (typeof element.type === "function") controls.set(element.type, element.props);
  walk(element.props.render, hrefs, texts, things, controls);
  walk(element.props.children, hrefs, texts, things, controls);
}

async function render() {
  const hrefs: string[] = [];
  const texts: string[] = [];
  const things: unknown[] = [];
  const controls = new Map<unknown, Record<string, unknown>>();
  walk(await ChurchSettings(), hrefs, texts, things, controls);
  return { hrefs, texts, things, controls };
}

beforeEach(() => {
  reads.organizations = { data: RULES, error: null };
  reads.site_settings = { data: { value: "admins" }, error: null };
});

afterEach(() => {
  sendingDomains.CUSTOM_SENDING_DOMAINS_ENABLED = false;
  prayerRetention.current = "off";
});

describe("ChurchSettings", () => {
  it("shows no Email sending domain tile for the sample org", async () => {
    const { hrefs, texts } = await render();

    expect(hrefs).not.toContain("/admin/settings/email");
    expect(texts).not.toContain("Email sending domain");
    expect(texts).toContain("Directory");
  });

  it("shows the tile once the flag is on", async () => {
    sendingDomains.CUSTOM_SENDING_DOMAINS_ENABLED = true;

    const { hrefs, texts } = await render();

    expect(hrefs).toContain("/admin/settings/email");
    expect(texts).toContain("Email sending domain");
  });

  it("groups every church-wide rule under a plain heading, with Email last when it is on", async () => {
    sendingDomains.CUSTOM_SENDING_DOMAINS_ENABLED = true;

    const { texts } = await render();
    const headings = ["Directory", "Groups", "Giving", "Events", "Prayer requests", "Email"];

    expect(texts.filter((text) => headings.includes(text))).toEqual(headings);
  });

  it("shows an error, not an off switch, when the prayer request setting can't be read", async () => {
    prayerRetention.current = null;

    const { things } = await render();

    expect(things).toContain("the prayer request setting");
  });

  it("hands each control the stored value", async () => {
    const { controls, things } = await render();

    expect(things).toEqual([]);
    expect(controls.get(GroupDiscoverySettings)).toMatchObject({ orgId: ORG_ID, discoveryOn: true });
    expect(controls.get(OrgGroupControls)).toMatchObject({ orgId: ORG_ID, policy: "open" });
    expect(controls.get(GivingSettings)).toMatchObject({ stewardsCanManage: false });
    expect(controls.get(TimezoneSettings)).toMatchObject({ orgId: ORG_ID, timezone: "America/Chicago" });
  });

  it("reads a church with no giving row as the default, not as a failure", async () => {
    reads.site_settings = { data: null, error: null };

    const { controls, things } = await render();

    expect(things).toEqual([]);
    expect(controls.get(GivingSettings)).toMatchObject({ stewardsCanManage: true });
  });

  it.each([
    ["fails", { data: null, error: { code: "XX000" } }],
    ["returns no row", { data: null, error: null }],
  ])("shows an error for the group rules and the time zone, not a control, when the church's row %s", async (_case, read) => {
    reads.organizations = read;

    const { controls, things } = await render();

    expect(things).toEqual(["the group settings", "the time zone"]);
    expect(controls.has(GroupDiscoverySettings)).toBe(false);
    expect(controls.has(OrgGroupControls)).toBe(false);
    expect(controls.has(TimezoneSettings)).toBe(false);
    expect(controls.has(GivingSettings)).toBe(true);
  });

  it("shows an error, not a switch, when the giving setting can't be read", async () => {
    reads.site_settings = { data: null, error: { code: "XX000" } };

    const { controls, things } = await render();

    expect(things).toEqual(["the giving setting"]);
    expect(controls.has(GivingSettings)).toBe(false);
    expect(controls.has(OrgGroupControls)).toBe(true);
  });
});
