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
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({
          data: {
            id: "l1",
            title: "One",
            description: null,
            video_url: "https://example.test/video",
            lecture_date: null,
            summary: null,
            series_id: null,
          },
          error: null,
        }),
      };
      return chain;
    },
  }),
}));

const { default: LessonPage } = await import("./page");

async function render(role: "leader" | "member") {
  state.role = role;
  return renderToStaticMarkup(
    await LessonPage({ params: Promise.resolve({ groupId: "g1", id: "l1" }) }),
  );
}

describe("LessonPage", () => {
  it("offers a leader Edit lesson", async () => {
    expect(await render("leader")).toContain('href="/g/g1/lectures/l1/edit"');
  });

  it("shows a member no way to edit", async () => {
    const html = await render("member");
    expect(html).not.toContain("Edit lesson");
    expect(html).not.toContain("/edit");
  });
});
