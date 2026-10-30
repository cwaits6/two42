import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PageHeader } from "./PageHeader";

type Props = Parameters<typeof PageHeader>[0];

function render(props: Props) {
  return renderToStaticMarkup(createElement(PageHeader, props));
}

describe("PageHeader", () => {
  it("renders the title as the page's one espresso serif heading", () => {
    const html = render({ title: "Invite links" });
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toMatch(/<h1 class="[^"]*\bfont-serif\b[^"]*\btext-foreground\b[^"]*">Invite links<\/h1>/);
  });

  it("renders nothing optional when given only a title", () => {
    const html = render({ title: "Invite links" });
    expect(html).not.toContain("<a");
    expect(html).not.toContain("<p");
    expect(html).not.toContain('data-slot="page-header-actions"');
  });

  it("renders the subtitle under the title", () => {
    const html = render({ title: "Add event", subtitle: "Posting to Grace" });
    expect(html.indexOf("Posting to Grace")).toBeGreaterThan(html.indexOf("</h1>"));
  });

  it("puts a labelled back link above the title at a 44px target", () => {
    const html = render({
      title: "Invite links",
      backHref: "/g/1/settings",
      backLabel: "Back to Group settings",
    });
    const link = html.match(/<a [^>]*>.*?<\/a>/)?.[0] ?? "";
    expect(link).toContain('href="/g/1/settings"');
    expect(link).toMatch(/class="[^"]*\bmin-h-11\b/);
    expect(link).toContain("Back to Group settings");
    expect(html.indexOf("<a ")).toBeLessThan(html.indexOf("<h1"));
  });

  it("stacks the action full width on phone and moves it beside the title on desktop", () => {
    const html = render({
      title: "Invite links",
      subtitle: "Grace",
      actions: createElement("button", null, "Create link"),
    });
    const actions = html.match(/<div data-slot="page-header-actions" class="([^"]*)">/)?.[1] ?? "";
    expect(actions.split(" ")).toEqual(
      expect.arrayContaining(["flex-col", "*:w-full", "md:flex-row", "md:*:w-auto"]),
    );
    expect(html.indexOf("Create link")).toBeGreaterThan(html.indexOf("Grace"));
    expect(html).toMatch(/class="[^"]*\bmd:flex-row\b[^"]*\bmd:justify-between\b/);
  });
});
