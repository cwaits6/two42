import { describe, expect, it } from "vitest";
import { isSidebarRoute } from "@/components/layout/AppShell";

describe("isSidebarRoute", () => {
  it.each(["/dashboard", "/events/123", "/directory/families", "/settings"])(
    "matches fixed top-level route %s",
    (pathname) => expect(isSidebarRoute(pathname)).toBe(true),
  );

  it.each(["/", "/login", "/join", "/acme/join", "/acme/pages/welcome"])(
    "does not match unrelated route %s",
    (pathname) => expect(isSidebarRoute(pathname)).toBe(false),
  );
});
