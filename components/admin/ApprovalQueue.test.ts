import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ApprovalQueue, type ApprovalQueueRow } from "./ApprovalQueue";

const rows: ApprovalQueueRow[] = [
  { id: "a", title: "Ada Lovelace" },
  { id: "b", title: "Cy Park" },
];

const render = (busyId: string | null, list = rows) =>
  renderToStaticMarkup(
    createElement(ApprovalQueue, {
      rows: list,
      busyId,
      emptyText: "No requests waiting.",
      onApprove: () => {},
      onDecline: () => {},
    }),
  );

const disabledButtons = (html: string) => html.match(/<button[^>]*\sdisabled=""/g)?.length ?? 0;

describe("ApprovalQueue", () => {
  it("offers Approve and Decline when nothing is in flight", () => {
    const html = render(null);
    expect(html).toContain("Approve");
    expect(html).toContain("Decline");
    expect(disabledButtons(html)).toBe(0);
  });

  it("disables every row's buttons while one action runs, so nothing submits twice", () => {
    expect(disabledButtons(render("a"))).toBe(4);
  });

  it("uses the empty state when the queue is empty", () => {
    const html = render(null, []);
    expect(html).toContain("No requests waiting.");
    expect(html).toContain("border-dashed");
  });
});
