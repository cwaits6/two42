import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GroupAvatar } from "./GroupAvatar";

const render = (color: string) => renderToStaticMarkup(createElement(GroupAvatar, { name: "Young Families", color }));

describe("GroupAvatar", () => {
  it("puts white initials on a dark group color", () => {
    expect(render("#B85C38")).toContain("color:#FFFFFF");
  });

  it("puts dark initials on a light group color", () => {
    const html = render("#FFFFFF");
    expect(html).toContain("background-color:#FFFFFF");
    expect(html).toContain("color:#2A211A");
  });
});
