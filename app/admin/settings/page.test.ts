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
vi.mock("@/components/directory/DirectoryVisibilitySettings", () => ({
  DirectoryVisibilitySettings: () => null,
}));
vi.mock("@/components/giving/GivingSettings", () => ({ GivingSettings: () => null }));

const sendingDomains = vi.hoisted(() => ({
  CUSTOM_SENDING_DOMAINS_ENABLED: false,
}));
vi.mock("@/lib/email/sendingDomains", () => sendingDomains);

const { default: SettingsPage } = await import("./page");

function walk(node: ReactNode, hrefs: string[], texts: string[]): void {
  if (Array.isArray(node)) {
    node.forEach((n) => walk(n, hrefs, texts));
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
  }>;
  if (typeof element.props.href === "string") hrefs.push(element.props.href);
  walk(element.props.render, hrefs, texts);
  walk(element.props.children, hrefs, texts);
}

async function render() {
  const hrefs: string[] = [];
  const texts: string[] = [];
  walk(await SettingsPage(), hrefs, texts);
  return { hrefs, texts };
}

afterEach(() => {
  sendingDomains.CUSTOM_SENDING_DOMAINS_ENABLED = false;
});

describe("SettingsPage", () => {
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
});
