import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

const TOKEN = "6d4ee000-0000-4000-8000-000000000003";
const INVITE_ROW = {
  id: "77777777-7777-4777-8777-777777777777",
  org_id: "org-1",
  group_id: "group-1",
  expires_at: null,
  max_uses: null,
  revoked_at: null,
  groups: { name: "Tuesday Table" },
  organizations: { name: "Grace Fellowship", branding: {} },
};

function chain(result: unknown) {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq"]) c[m] = () => c;
  c.maybeSingle = async () => result;
  c.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return c;
}

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: async () => ({
    from: (table: string) =>
      table === "group_invites"
        ? chain({ data: INVITE_ROW, error: null })
        : chain({ count: 0, error: null }),
  }),
  createClient: async () => {
    throw new Error("a signed-out viewer needs no request client");
  },
}));
vi.mock("@/lib/supabase/current-user", () => ({ getOptionalUser: async () => null }));
vi.mock("@/lib/pageTitle", () => ({ pageTitle: async () => ({}) }));
vi.mock("./InviteSignupForm", () => ({ InviteSignupForm: () => null }));

const { default: JoinByInvitePage } = await import("./page");

describe("JoinByInvitePage signed out", () => {
  it("offers Sign in that returns to the invite", async () => {
    const page = await JoinByInvitePage({ params: Promise.resolve({ token: TOKEN }) });
    const html = renderToStaticMarkup(page as ReactElement);

    expect(html).toContain("Join Tuesday Table");
    expect(html).toContain(`href="/login?redirect=${encodeURIComponent(`/join/${TOKEN}`)}"`);
  });
});
