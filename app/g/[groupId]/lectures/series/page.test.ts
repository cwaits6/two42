import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ series: [] as unknown[] | null }));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) =>
    createElement("a", { href }, children),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/lib/groups/server", () => ({
  requireGroupLeader: async (id: string) => ({ id, name: "Grace", role: "leader" }),
}));
vi.mock("@/lib/pageTitle", () => ({ groupPageTitle: () => async () => ({}) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: async () =>
          state.series ? { data: state.series, error: null } : { data: null, error: { code: "57014" } },
      };
      return chain;
    },
  }),
}));

const { default: ManageSeriesPage } = await import("./page");

const ADD_SERIES = 'href="/g/g1/lectures/series/new"';
const count = (html: string, needle: string) => html.split(needle).length - 1;

async function render() {
  return renderToStaticMarkup(await ManageSeriesPage({ params: Promise.resolve({ groupId: "g1" }) }));
}

beforeEach(() => {
  state.series = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("ManageSeriesPage", () => {
  it("offers Add series once, in the empty state, when there is no series", async () => {
    const html = await render();
    expect(html).toContain("No series yet.");
    expect(count(html, ADD_SERIES)).toBe(1);
    expect(html.indexOf(ADD_SERIES)).toBeGreaterThan(html.indexOf("No series yet."));
  });

  it("offers Add series once, in the header, when there are series", async () => {
    state.series = [{ id: "s1", name: "Acts", teacher: "Ana", is_archived: false, lectures: [{ count: 2 }] }];
    const html = await render();
    expect(html).toContain("Acts");
    expect(count(html, ADD_SERIES)).toBe(1);
  });

  it("keeps Add series in the header when the series cannot be read", async () => {
    state.series = null;
    const html = await render();
    expect(html).not.toContain("No series yet.");
    expect(count(html, ADD_SERIES)).toBe(1);
  });
});
