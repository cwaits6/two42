import { describe, expect, it } from "vitest";
import { isSidebarRoute } from "@/components/layout/AppShell";

const A = "11111111-1111-4111-8111-111111111111";

describe("isSidebarRoute", () => {
  it.each([
    "/dashboard",
    "/calendar",
    "/directory/families",
    "/find-a-group",
    "/settings",
    "/serving/go",
    `/g/${A}`,
    `/g/${A}/calendar/123`,
  ])("matches %s", (pathname) => expect(isSidebarRoute(pathname)).toBe(true));

  it.each([
    "/",
    "/login",
    "/join",
    "/acme/join",
    "/grace/join",
    "/give",
    "/events",
    "/dashboards",
  ])("does not match %s", (pathname) => expect(isSidebarRoute(pathname)).toBe(false));
});
