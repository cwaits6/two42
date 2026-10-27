import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GROUP_DEFAULT_COLOR } from "@/lib/groups/calendar";
import type { MemberGroup } from "@/lib/types";

// The dialog primitive portals its popup into document.body, which a static
// render never has, so these stand-ins keep the composed labels in the markup.
vi.mock("@/components/ui/dialog", () => {
  type Props = { children?: ReactNode };
  function Dialog({ open, children }: Props & { open: boolean }) {
    return open ? createElement("div", { role: "dialog" }, children) : null;
  }
  function DialogContent({ children }: Props) {
    return createElement("div", null, children);
  }
  function DialogHeader({ children }: Props) {
    return createElement("div", null, children);
  }
  function DialogFooter({ children }: Props) {
    return createElement("div", null, children);
  }
  function DialogTitle({ children }: Props) {
    return createElement("h2", null, children);
  }
  function DialogDescription({ children }: Props) {
    return createElement("p", null, children);
  }
  return { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription };
});

const { RemoveTeamDialog } = await import("./RemoveTeamDialog");

const greeters = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Greeters",
  color: GROUP_DEFAULT_COLOR,
  display_order: 0,
} as MemberGroup;

function render(team: MemberGroup | null, memberCount: number) {
  return renderToStaticMarkup(
    createElement(RemoveTeamDialog, {
      team,
      memberCount,
      onCancel: () => {},
      onConfirm: async () => {},
    }),
  );
}

beforeEach(() => {
  vi.stubGlobal("confirm", () => {
    throw new Error("the remove flow must not fall back to window.confirm");
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RemoveTeamDialog", () => {
  it("names the team and offers Remove team and Cancel", () => {
    const html = render(greeters, 3);
    expect(html).toContain('role="dialog"');
    expect(html).toContain("Remove Greeters?");
    expect(html).toContain(">Remove team<");
    expect(html).toContain(">Cancel<");
  });

  it("says how many members come off the team", () => {
    expect(render(greeters, 3)).toContain("3 members will be taken off this team.");
    expect(render(greeters, 1)).toContain("1 member will be taken off this team.");
    expect(render(greeters, 0)).toContain("No one is on this team yet.");
  });

  it("renders nothing until a team is chosen", () => {
    expect(render(null, 0)).toBe("");
  });
});
