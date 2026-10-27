import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const { DeleteEventDialog } = await import("./DeleteEventDialog");

function render(props: {
  open?: boolean;
  series: { upcomingCount: number | null } | null;
  occurrenceLabel: string | null;
}) {
  return renderToStaticMarkup(
    createElement(DeleteEventDialog, {
      open: props.open ?? true,
      onOpenChange: () => {},
      series: props.series,
      occurrenceLabel: props.occurrenceLabel,
      onDeleteDate: async () => {},
      onDeleteAll: async () => {},
    }),
  );
}

beforeEach(() => {
  vi.stubGlobal("confirm", () => {
    throw new Error("the delete flow must not fall back to window.confirm");
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DeleteEventDialog", () => {
  it("gives a one-off event one confirmation with no scope choice", () => {
    const html = render({ series: null, occurrenceLabel: null });
    expect(html).toContain('role="dialog"');
    expect(html).toContain("Delete this event?");
    expect(html).toContain(">Delete event<");
    expect(html).toContain(">Cancel<");
    expect(html).not.toContain("This date only");
    expect(html).not.toContain("All dates");
  });

  it("asks which dates are meant when opened for one date of a repeating event", () => {
    const html = render({ series: { upcomingCount: 4 }, occurrenceLabel: "Tuesday, November 3" });
    expect(html).toContain("Delete which dates?");
    expect(html).toContain("Delete only the Tuesday, November 3 date, or every date?");
    expect(html).toContain(">This date only<");
    expect(html).toContain(">All dates<");
    expect(html).toContain(">Cancel<");
    expect(html).not.toContain("Delete all dates");
  });

  it("says every date goes, and how many are still to come, for a whole series", () => {
    const html = render({ series: { upcomingCount: 4 }, occurrenceLabel: null });
    expect(html).toContain("Delete every date?");
    expect(html).toContain(
      "This deletes every date of this repeating event, including 4 dates still to come.",
    );
    expect(html).toContain(">Delete all dates<");
    expect(html).not.toContain("This date only");

    expect(render({ series: { upcomingCount: 1 }, occurrenceLabel: null })).toContain(
      "including 1 date still to come.",
    );
    expect(render({ series: { upcomingCount: 0 }, occurrenceLabel: null })).toContain(
      "This deletes every date of this repeating event. None are still to come.",
    );
    expect(render({ series: { upcomingCount: null }, occurrenceLabel: null })).toContain(
      "This deletes every date of this repeating event, which has no end date.",
    );
  });

  it("renders nothing while closed", () => {
    expect(render({ open: false, series: null, occurrenceLabel: null })).toBe("");
  });
});
