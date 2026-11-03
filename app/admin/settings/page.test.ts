import { afterEach, describe, expect, it, vi } from "vitest";
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

vi.mock("@/lib/supabase/current-user", () => ({
  getOptionalUser: async () => ({ id: "user-1", email: undefined }),
}));

// The page never reads organizations.custom_email_domain_enabled: the flag,
// not the column, decides whether the tile renders.
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          single: async () =>
            table === "profiles"
              ? { data: { role: "admin", org_id: ORG_ID } }
              : { data: null },
        }),
      }),
    }),
  }),
}));

vi.mock("@/lib/giving/server", () => ({
  givingStewardsCanManage: async () => false,
}));
vi.mock("@/lib/directory/visibility", () => ({
  getDirectoryVisibility: async () => "shared_groups",
}));
vi.mock("@/components/admin/DirectoryVisibilitySettings", () => ({
  DirectoryVisibilitySettings: () => null,
}));
vi.mock("@/components/giving/GivingSettings", () => ({ GivingSettings: () => null }));
vi.mock("@/lib/orgPrayerRetention", () => ({
  getPrayerRetention: async () => prayerRetention.current,
}));
vi.mock("@/components/admin/PrayerRetentionSettings", () => ({
  PrayerRetentionSettings: () => null,
}));

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
  things: unknown[] = []
): void {
  if (Array.isArray(node)) {
    node.forEach((n) => walk(n, hrefs, texts, things));
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
  walk(element.props.render, hrefs, texts, things);
  walk(element.props.children, hrefs, texts, things);
}

async function render() {
  const hrefs: string[] = [];
  const texts: string[] = [];
  const things: unknown[] = [];
  walk(await ChurchSettings(), hrefs, texts, things);
  return { hrefs, texts, things };
}

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

  it("shows an error, not an off switch, when the prayer request setting can't be read", async () => {
    prayerRetention.current = null;

    const { things } = await render();

    expect(things).toContain("the prayer request setting");
  });
});
