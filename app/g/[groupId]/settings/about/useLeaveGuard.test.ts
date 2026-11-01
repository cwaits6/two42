import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({}) }));

const { leavingHref } = await import("./useLeaveGuard");

const HERE = "https://two42.test/g/1/settings/about?x=1";
const click = {
  button: 0,
  modified: false,
  defaultPrevented: false,
  href: "https://two42.test/g/1/settings",
  target: null,
  download: false,
};

describe("leavingHref", () => {
  it("holds a plain click on a link to another page", () => {
    expect(leavingHref(click, HERE)).toBe("https://two42.test/g/1/settings");
  });

  it("holds a link to another site", () => {
    expect(leavingHref({ ...click, href: "https://example.test/" }, HERE)).toBe("https://example.test/");
  });

  it.each([
    ["a click that is not on a link", { href: null }],
    ["a right or middle click", { button: 1 }],
    ["a click with a modifier, which opens a new tab", { modified: true }],
    ["a link opening a new tab", { target: "_blank" }],
    ["a download", { download: true }],
    ["a click something already handled", { defaultPrevented: true }],
    ["a mail link", { href: "mailto:a@example.test" }],
    ["a link to a place on this page", { href: `${HERE}#leadership` }],
  ])("lets %s through", (_name, override) => {
    expect(leavingHref({ ...click, ...override }, HERE)).toBeNull();
  });
});
