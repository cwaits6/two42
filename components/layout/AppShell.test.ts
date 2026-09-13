import { describe, expect, it } from "vitest";
import { isSidebarRoute } from "@/components/layout/AppShell";

describe("isSidebarRoute", () => {
  it.each(["/dashboard", "/events/123", "/directory/families", "/settings"])(
    "matches fixed top-level route %s",
    (pathname) => expect(isSidebarRoute(pathname)).toBe(true),
  );

  it.each(["/acme/pages/welcome", "/other-org/pages/about"])(
    "matches the org-scoped pages route %s",
    (pathname) => expect(isSidebarRoute(pathname)).toBe(true),
  );

  it("matches the bare org-scoped pages index", () => {
    expect(isSidebarRoute("/acme/pages")).toBe(true);
  });

  it.each(["/admin/pages", "/admin/pages/welcome/edit", "/platform/pages"])(
    "does not treat %s as an org slug",
    (pathname) => expect(isSidebarRoute(pathname)).toBe(false),
  );

  it.each(["/", "/login", "/join", "/acme/join"])(
    "does not match unrelated route %s",
    (pathname) => expect(isSidebarRoute(pathname)).toBe(false),
  );
});
