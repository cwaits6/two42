import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "leader",
  lessons: [] as unknown[],
  series: [] as unknown[],
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) =>
    createElement("a", { href }, children),
}));
vi.mock("@/lib/groups/server", () => ({
  requireActiveGroup: async (id: string) => ({ id, name: "Grace", role: state.role }),
}));
vi.mock("@/lib/pageTitle", () => ({ groupPageTitle: () => async () => ({}) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        then: (resolve: (value: unknown) => void) =>
          resolve({ data: table === "lectures" ? state.lessons : state.series, error: null }),
      };
      return chain;
    },
  }),
}));

const { default: LessonsPage } = await import("./page");

const BASE = "/g/g1/lectures";
const lesson = (id: string, seriesId: string | null, summary: string | null) => ({
  id,
  title: `Lesson ${id}`,
  description: null,
  video_url: "https://example.test/video",
  lecture_date: "2026-01-01",
  summary,
  series_id: seriesId,
});

async function render(searchParams: { view?: string; filter?: string } = {}) {
  return renderToStaticMarkup(
    await LessonsPage({
      params: Promise.resolve({ groupId: "g1" }),
      searchParams: Promise.resolve(searchParams),
    }),
  );
}

beforeEach(() => {
  state.role = "leader";
  state.series = [{ id: "s1", name: "Acts", teacher: "Ana", is_archived: false }];
  state.lessons = [lesson("l1", "s1", "Written"), lesson("l2", null, null)];
});

describe("LessonsPage for a leader", () => {
  it("offers Add lesson and Manage series in the header", async () => {
    const html = await render();
    expect(html).toContain(`href="${BASE}/new"`);
    expect(html).toContain(`href="${BASE}/series"`);
  });

  it("offers Edit on each lesson and series", async () => {
    const html = await render();
    expect(html).toContain(`href="${BASE}/l1/edit"`);
    expect(html).toContain(`href="${BASE}/l2/edit"`);
    expect(html).toContain(`href="${BASE}/series/s1/edit"`);
  });

  it("offers Add lesson and Manage series when there are no lessons", async () => {
    state.lessons = [];
    const html = await render();
    expect(html).toContain("No lessons yet.");
    expect(html).toContain(`href="${BASE}/new"`);
    expect(html).toContain(`href="${BASE}/series"`);
  });

  it("filters to the lessons that need a summary, counted in the tab", async () => {
    const html = await render({ filter: "needs-summary" });
    expect(html).toContain("Needs summary (1)");
    const list = html.slice(html.indexOf('aria-label="Show lessons"'));
    expect(list).toContain(`href="${BASE}/l2"`);
    expect(list).not.toContain(`href="${BASE}/l1"`);
  });

  it("says so when every lesson has a summary", async () => {
    state.lessons = [lesson("l1", "s1", "Written")];
    expect(await render({ filter: "needs-summary" })).toContain("Every lesson has a summary.");
  });
});

describe("LessonsPage for a member", () => {
  beforeEach(() => {
    state.role = "member";
  });

  it("shows no leader action, with lessons or without", async () => {
    for (const lessons of [state.lessons, []]) {
      state.lessons = lessons;
      const html = await render();
      expect(html).not.toContain("Add lesson");
      expect(html).not.toContain("Manage series");
      expect(html).not.toContain("Needs summary");
      expect(html).not.toContain("/edit");
    }
  });

  it("ignores the needs-summary filter", async () => {
    const html = await render({ filter: "needs-summary" });
    expect(html).not.toContain("Every lesson has a summary.");
    expect(html).toContain(`href="${BASE}/l1"`);
    expect(html).toContain("Other lessons");
  });
});
