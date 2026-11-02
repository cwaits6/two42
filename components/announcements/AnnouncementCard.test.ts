import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Announcement } from "@/lib/types";

vi.mock("next/link", () => ({
  default: (props: { href: string; children?: ReactNode }) => createElement("a", props),
}));

const { AnnouncementCard } = await import("./AnnouncementCard");

const announcement = {
  id: "a1",
  title: "Picnic",
  content: "[]",
  published_at: "2026-01-01T12:00:00Z",
  created_at: "2026-01-01T12:00:00Z",
} as Announcement;

const render = (editHref?: string) =>
  renderToStaticMarkup(
    createElement(AnnouncementCard, { announcement, timeZone: "America/New_York", editHref }),
  );

describe("AnnouncementCard", () => {
  it("links to the editor, naming the announcement, when given an edit link", () => {
    const html = render("/g/g1/announcements/a1/edit");
    expect(html).toContain('href="/g/g1/announcements/a1/edit"');
    expect(html).toContain('aria-label="Edit Picnic"');
  });

  it("shows no Edit without one", () => {
    expect(render()).not.toContain("Edit");
  });
});
