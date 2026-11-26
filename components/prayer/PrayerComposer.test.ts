import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PrayerComposer } from "@/components/prayer/PrayerComposer";
import { PrayerCard } from "@/components/prayer/PrayerCard";
import { PrayerCommentForm } from "@/components/prayer/PrayerCommentForm";
import { askerLabel } from "@/components/prayer/PrayerThread";
import type { PrayerCommentView } from "@/lib/prayer/comments";
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
  suffix: null,
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
  const render = (r: PrayerWallRow, comments: PrayerCommentView[] | null = []) =>
    renderToStaticMarkup(
      createElement(PrayerCard, {
        row: r,
        prayPending: false,
        onPray: () => {},
        onToggleAnswered: () => {},
        onDelete: () => {},
        comments,
        onComment: async () => true,
        onDeleteComment: () => {},
        timeZone: "America/New_York",
      })
    );

  const comment: PrayerCommentView = {
    id: "c1",
    request_id: "r1",
    body: "Praying for you this week.",
    only_asker: false,
    hide_name: false,
    created_at: new Date().toISOString(),
    mine: false,
    can_delete: false,
    first_name: "Ben",
    last_name: "Writer",
    preferred_name: null,
  suffix: null,
  };

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

  it("offers Delete only on the viewer's own request, by name or anonymous", () => {
    expect(render({ ...row, mine: true })).toContain("Delete");
    expect(render({ ...row, mine: true, is_anonymous: true })).toContain("Delete");
    expect(render(row)).not.toContain("Delete");
    expect(render({ ...row, is_anonymous: true })).not.toContain("Delete");
  });

  it("lists each comment under the request with its writer, and offers Delete only where allowed", () => {
    const html = render(row, [comment, { ...comment, id: "c2", body: "Second word.", can_delete: true }]);
    expect(html).toContain("Praying for you this week.");
    expect(html).toContain("Second word.");
    expect(html).toContain("Ben Writer");
    expect(html.match(/>Delete</g)).toHaveLength(1);
  });

  it("shows a hidden-name comment as Anonymous, even with a name on the row", () => {
    const html = render(row, [{ ...comment, hide_name: true, mine: true }]);
    expect(html).toContain("Anonymous");
    expect(html).not.toContain("Ben");
    expect(html).toContain(">You<");
  });

  it("marks a private comment, and says so when the comments couldn't load", () => {
    expect(render(row, [{ ...comment, only_asker: true }])).toContain("Private");
    const failed = render(row, null);
    expect(failed).toContain("Comments couldn&#x27;t load.");
    expect(failed).not.toContain(">Comment<");
  });
});

describe("PrayerCommentForm", () => {
  const render = (ownRequest: boolean, ownAnonymousRequest = false, askerLabel = "Ada Author") =>
    renderToStaticMarkup(
      createElement(PrayerCommentForm, {
        askerLabel,
        ownRequest,
        ownAnonymousRequest,
        onPost: async () => true,
        onCancel: () => {},
      })
    );

  it("labels the text and both choices on someone else's request", () => {
    const html = render(false);
    expect(html).toContain("Add a comment");
    expect(html).toContain("Only Ada Author can see this");
    expect(html).toContain("Hide my name");
    expect(html).toContain("Post comment");
  });

  it("offers no private choice on the viewer's own request", () => {
    const html = render(true);
    expect(html).not.toContain("can see this");
    expect(html).toContain("Hide my name");
  });

  it("starts with the name shown on someone else's request and on the viewer's own named request", () => {
    expect(render(false)).not.toContain('aria-checked="true"');
    expect(render(true)).not.toContain('aria-checked="true"');
  });

  it("starts with the name hidden, and warns, on the viewer's own anonymous request", () => {
    const html = render(true, true);
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain("Your request is anonymous. Turn this off and your name shows on this comment.");
  });

  it("names no one when the request is anonymous", () => {
    expect(askerLabel({ ...row, is_anonymous: true })).toBe("the person who asked");
    expect(askerLabel({ ...row, first_name: null, last_name: null })).toBe("the person who asked");
    expect(askerLabel(row)).toBe("Ada Author");
  });
});
