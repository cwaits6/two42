import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { LeaderRoster } from "./groupLeaders";

// The dialog primitive needs its root's context, which a static render of the
// body alone never has, so these stand-ins keep the composed copy in the markup.
vi.mock("@/components/ui/dialog", () => {
  type Props = { children?: ReactNode };
  const passthrough = (tag: string) =>
    function Part({ children }: Props) {
      return createElement(tag, null, children);
    };
  return {
    Dialog: passthrough("div"),
    DialogContent: passthrough("div"),
    DialogHeader: passthrough("div"),
    DialogTitle: passthrough("h2"),
    DialogDescription: passthrough("p"),
  };
});

const { GroupLeadersView } = await import("./GroupLeadersDialog");
type ViewProps = Parameters<typeof GroupLeadersView>[0];

const roster: LeaderRoster = {
  people: [
    { id: "a", first_name: "Ada", last_name: "Lovelace", preferred_name: null },
    { id: "b", first_name: "Ben", last_name: "Okafor", preferred_name: null },
    { id: "c", first_name: "Cy", last_name: "Park", preferred_name: null },
  ],
  roles: new Map([
    ["a", "leader"],
    ["c", "member"],
  ]),
};

function render(overrides: Partial<ViewProps> = {}) {
  return renderToStaticMarkup(
    createElement(GroupLeadersView, {
      groupName: "Tuesday Group",
      roster,
      loadFailed: false,
      mode: { kind: "leaders" },
      query: "",
      busy: false,
      error: null,
      onModeChange: () => {},
      onQueryChange: () => {},
      onAdd: () => {},
      onRemove: () => {},
      ...overrides,
    }),
  );
}

describe("GroupLeadersView", () => {
  it("shows only the current leaders by default, with an explicit Add leader", () => {
    const html = render();
    expect(html).toContain("Leaders of Tuesday Group");
    expect(html).toContain("Ada Lovelace");
    expect(html).toContain('aria-label="Replace Ada Lovelace"');
    expect(html).toContain('aria-label="Remove Ada Lovelace as leader"');
    expect(html).toContain("Add leader");
    expect(html).not.toContain("Ben Okafor");
    expect(html).not.toContain("Cy Park");
  });

  it("says when a group has no leader", () => {
    const html = render({ roster: { people: roster.people, roles: new Map() } });
    expect(html).toContain("This group has no leader yet.");
    expect(html).toContain("Add leader");
  });

  it("offers the group's members and the rest of the directory in add mode", () => {
    const html = render({ mode: { kind: "add", replacing: null } });
    expect(html).toContain("Add leader to Tuesday Group");
    expect(html).toContain('aria-label="Back to leaders"');
    expect(html.indexOf("Cy Park")).toBeLessThan(html.indexOf("Ben Okafor"));
    expect(html).toContain("In this group");
    expect(html).toContain("Not in this group yet");
    expect(html).not.toContain("Make Ada Lovelace a leader");
  });

  it("names the leader being replaced", () => {
    const html = render({ mode: { kind: "add", replacing: roster.people[0] } });
    expect(html).toContain("Replace Ada Lovelace");
  });

  it("shows a write error inline", () => {
    const html = render({ error: "Couldn't remove them as a leader. Reload the page and try again." });
    expect(html).toContain('role="alert"');
    expect(html).toContain("Couldn&#x27;t remove them as a leader.");
  });

  it("tells loading apart from a failed load", () => {
    expect(render({ roster: null })).toContain("Loading leaders...");
    const failed = render({ roster: null, loadFailed: true });
    expect(failed).toContain("Couldn&#x27;t load this group&#x27;s leaders.");
    expect(failed).not.toContain("Loading leaders...");
  });
});
