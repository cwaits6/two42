import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Megaphone } from "lucide-react";
import { describe, expect, it } from "vitest";
import { EmptyState } from "./EmptyState";

type Props = Parameters<typeof EmptyState>[0];

function render(props: Omit<Props, "icon">) {
  return renderToStaticMarkup(createElement(EmptyState, { icon: Megaphone, ...props }));
}

describe("EmptyState", () => {
  it("states the empty list in a dashed box with a decorative icon", () => {
    const html = render({ message: "No announcements yet" });
    expect(html).toContain("No announcements yet");
    expect(html).toMatch(/^<div class="[^"]*\bborder-dashed\b/);
    expect(html).toMatch(/<svg [^>]*aria-hidden="true"/);
  });

  it("is not announced as an alert or a status", () => {
    const html = render({ message: "No announcements yet" });
    expect(html).not.toContain("role=");
  });

  it("renders the action below the statement when one is given", () => {
    const html = render({
      message: "No announcements yet",
      action: createElement("a", { href: "/new" }, "Add announcement"),
    });
    expect(html.indexOf("Add announcement")).toBeGreaterThan(html.indexOf("No announcements yet"));
  });

  it("renders no action for people who cannot act", () => {
    const html = render({ message: "No announcements yet", action: false });
    expect(html).not.toContain("<a");
    expect(html).not.toContain("<button");
  });
});
