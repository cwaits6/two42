import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HiddenFunds, type HiddenFundRow } from "./HiddenFunds";

function render(fund: Partial<HiddenFundRow>) {
  const row = {
    id: "fund-1",
    name: "Building fund",
    steward_role: null,
    is_active: true,
    retire_on: null,
    needs_review: true,
    ...fund,
  } as HiddenFundRow;
  return renderToStaticMarkup(
    createElement(HiddenFunds, { groupId: "group-1", funds: [row], methods: [], today: "2026-11-01" })
  );
}

describe("HiddenFunds recipient line", () => {
  it("doesn't call a fund recipientless when the viewer just can't read who it is", () => {
    const html = render({ steward_id: "unlisted", steward: null });
    expect(html).toContain("Needs review");
    expect(html).toContain("Goes to someone not listed in the directory");
    expect(html).not.toContain("No one named");
  });

  it("says no one is named when no one is", () => {
    const html = render({ steward_id: null, steward: null });
    expect(html).toContain("Needs a recipient");
    expect(html).toContain("No one named to receive it");
  });
});
