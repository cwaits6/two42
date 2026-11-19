import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ role: "leader", videoUrl: "https://example.test/video" }));

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
            video_url: state.videoUrl,
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

async function render(role: "leader" | "member", videoUrl = "https://example.test/video") {
  state.role = role;
  state.videoUrl = videoUrl;
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

  it("plays a YouTube recording on the page, with a way out to YouTube", async () => {
    const html = await render("member", "https://youtu.be/jNQXAC9IVRw?si=x");
    expect(html).toContain(
      '<iframe src="https://www.youtube-nocookie.com/embed/jNQXAC9IVRw" title="Recording of One" allow="encrypted-media; picture-in-picture; fullscreen" allowFullScreen="" referrerPolicy="strict-origin-when-cross-origin" loading="lazy"',
    );
    expect(html).toContain('href="https://youtu.be/jNQXAC9IVRw?si=x" target="_blank" rel="noopener noreferrer"');
    expect(html).toContain("Watch on YouTube");
    expect(html).not.toContain("Watch recording");
  });

  it("links out to a recording that is not on YouTube", async () => {
    const html = await render("member");
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("Watch on YouTube");
    expect(html).toContain('href="https://example.test/video"');
    expect(html).toContain("Watch recording");
  });
});
