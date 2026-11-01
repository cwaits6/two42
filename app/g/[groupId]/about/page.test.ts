import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GROUP_DEFAULT_COLOR } from "@/lib/groups/calendar";

vi.mock("next/navigation", () => ({ redirect: vi.fn(), useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) =>
    createElement("a", { href }, children),
}));
vi.mock("@/lib/storageRead", () => ({ mintSignedUrls: async () => [] }));
vi.mock("@/lib/supabase/current-user", () => ({ getOptionalUser: async () => ({ id: "user-1" }) }));
vi.mock("@/lib/groups/settings", () => ({ getGroupSettings: async () => ({}) }));
const requireActiveGroup = vi.fn();
vi.mock("@/lib/groups/server", () => ({
  requireActiveGroup: (groupId: string) => requireActiveGroup(groupId),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        single: async () => ({ data: { role: "member", org_id: "org-1" }, error: null }),
        maybeSingle: async () => ({ data: null, error: null }),
        then: (resolve: (value: unknown) => void) =>
          resolve(table === "class_teachers" ? teachersRead : { data: [], error: null }),
      };
      return chain;
    },
  }),
}));

let teachersRead: { data: unknown[] | null; error: { code: string } | null };

const { default: AboutGroupPage } = await import("./page");

const ID = "11111111-1111-4111-8111-111111111111";
const EDIT_HREF = `href="/g/${ID}/settings/about"`;

async function render(role: "leader" | "member") {
  requireActiveGroup.mockResolvedValue({ id: ID, name: "Grace", color: GROUP_DEFAULT_COLOR, role });
  return renderToStaticMarkup(await AboutGroupPage({ params: Promise.resolve({ groupId: ID }) }));
}

beforeEach(() => {
  teachersRead = { data: [], error: null };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("AboutGroupPage", () => {
  it("offers Edit page to a leader", async () => {
    const html = await render("leader");
    expect(html).toContain("Edit page");
    expect(html).toContain(EDIT_HREF);
  });

  it("offers a member no link into settings, which would be a 404 for them", async () => {
    const html = await render("member");
    expect(html).not.toContain("Edit page");
    expect(html).not.toContain(EDIT_HREF);
  });

  it("holds to the same rule when the page fails to load", async () => {
    teachersRead = { data: null, error: { code: "boom" } };
    expect(await render("member")).not.toContain(EDIT_HREF);
    expect(await render("leader")).toContain(EDIT_HREF);
  });
});
