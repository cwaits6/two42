import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ role: "leader" }));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) =>
    createElement("a", { href }, children),
}));
vi.mock("next/navigation", () => ({ notFound: vi.fn() }));
vi.mock("@/lib/groups/server", () => ({
  requireActiveGroup: async (id: string) => ({ id, name: "Grace", role: state.role }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({
          data: { id: "s1", name: "Acts", teacher: null, is_archived: false },
          error: null,
        }),
        then: (resolve: (value: unknown) => void) =>
          resolve({
            data:
              table === "lectures"
                ? [{ id: "l1", title: "One", description: null, lecture_date: null, series_id: "s1" }]
                : [],
            error: null,
          }),
      };
      return chain;
    },
  }),
}));

const { default: SeriesPage } = await import("./page");

async function render(role: "leader" | "member") {
  state.role = role;
  return renderToStaticMarkup(
    await SeriesPage({ params: Promise.resolve({ groupId: "g1", id: "s1" }) }),
  );
}

describe("SeriesPage", () => {
  it("offers a leader Edit series, Add lesson and Edit on each lesson", async () => {
    const html = await render("leader");
    expect(html).toContain('href="/g/g1/lectures/series/s1/edit"');
    expect(html).toContain('href="/g/g1/lectures/new?series=s1"');
    expect(html).toContain('href="/g/g1/lectures/l1/edit"');
  });

  it("shows a member none of them", async () => {
    const html = await render("member");
    expect(html).not.toContain("/edit");
    expect(html).not.toContain("/new");
  });
});
