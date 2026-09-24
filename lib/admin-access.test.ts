import { describe, expect, it } from "vitest";
import {
  CONTENT_EDITOR_ADMIN_PATHS,
  isContentEditorAllowed,
} from "@/lib/admin-access";

describe("CONTENT_EDITOR_ADMIN_PATHS", () => {
  it("grants only the admin overview and the About Page editor", () => {
    expect(CONTENT_EDITOR_ADMIN_PATHS).toEqual(["/admin", "/admin/about"]);
  });
});

describe("isContentEditorAllowed", () => {
  it.each(["/admin", "/admin/about", "/admin/about/edit"])(
    "allows %s",
    (pathname) => {
      expect(isContentEditorAllowed(pathname)).toBe(true);
    }
  );

  it.each([
    "/admin/pages",
    "/admin/pages/welcome/edit",
    "/admin/lectures",
    "/admin/announcements/new",
    "/admin/members",
    "/admin/groups",
    "/admin/settings",
  ])("denies %s", (pathname) => {
    expect(isContentEditorAllowed(pathname)).toBe(false);
  });

  it("does not treat /admin as a prefix grant for every admin path", () => {
    // "/admin" is allowed only as an exact match; a plain startsWith on it
    // would open every /admin/* page to a content editor.
    expect(isContentEditorAllowed("/admin/anything")).toBe(false);
  });

  it("matches allowed sections on a path segment, not a string prefix", () => {
    expect(isContentEditorAllowed("/admin/aboutus")).toBe(false);
    expect(isContentEditorAllowed("/admin/about-archive")).toBe(false);
  });

  it("ignores paths outside /admin", () => {
    expect(isContentEditorAllowed("/dashboard")).toBe(false);
    expect(isContentEditorAllowed("/about")).toBe(false);
  });
});
