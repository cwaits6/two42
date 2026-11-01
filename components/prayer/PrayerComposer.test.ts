import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PrayerComposer } from "@/components/prayer/PrayerComposer";
import { PrayerCard } from "@/components/prayer/PrayerCard";
import type { PrayerWallRow } from "@/lib/types";

const me = { id: "u1", name: "Ada Author", initials: "AA", avatarUrl: null };

const row: PrayerWallRow = {
  id: "r1",
  group_id: "g1",
  body: "Pray for a steady week.",
  is_anonymous: false,
  is_answered: false,
  created_at: new Date().toISOString(),
  mine: false,
  first_name: "Ada",
  last_name: "Author",
  preferred_name: null,
  avatar_url: null,
  praying_count: 0,
  i_am_praying: false,
};

describe("PrayerComposer", () => {
  it("offers only the request text and the anonymous switch", () => {
    const html = renderToStaticMarkup(
      createElement(PrayerComposer, { me, groupName: "Grace", onPost: async () => true })
    );
    expect(html).toContain("What can we pray with you about?");
    expect(html).toContain("Share anonymously");
    expect(html).toContain("Post request");
    expect(html).not.toMatch(/Category|Health|Family|Thanksgiving|Prodigal|Guidance|Grief/);
  });
});

describe("PrayerCard", () => {
  const render = (r: PrayerWallRow) =>
    renderToStaticMarkup(
      createElement(PrayerCard, {
        row: r,
        prayPending: false,
        onPray: () => {},
        onToggleAnswered: () => {},
        timeZone: "America/New_York",
      })
    );

  it("shows the author's name on a by-name request and nothing else above the text", () => {
    const html = render(row);
    expect(html).toContain("Ada Author");
    expect(html).not.toMatch(/Health|Prayer warriors|Restricted/);
  });

  it("shows Anonymous and no name on an anonymous request", () => {
    const html = render({ ...row, is_anonymous: true, first_name: null, last_name: null });
    expect(html).toContain("Anonymous");
    expect(html).not.toContain("Ada");
  });
});
