import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getOptionalUser = vi.fn();
const getRequestBranding = vi.fn();
const getGroupMemberships = vi.fn();
vi.mock("@/lib/supabase/current-user", () => ({ getOptionalUser: () => getOptionalUser() }));
vi.mock("@/lib/branding", () => ({ getRequestBranding: () => getRequestBranding() }));
vi.mock("@/lib/groups/server", () => ({ getGroupMemberships: () => getGroupMemberships() }));

const { formatPageTitle, groupPageTitle, pageTitle } = await import("./pageTitle");

const GROUP_B = "c0000000-0000-0000-0000-00000000000b";
const GROUP_C = "c0000000-0000-0000-0000-00000000000c";

beforeEach(() => {
  getOptionalUser.mockReset().mockResolvedValue({ id: "user-1" });
  getRequestBranding.mockReset().mockResolvedValue({ display_name: "Grace Church" });
  getGroupMemberships.mockReset().mockResolvedValue([{ id: GROUP_B, name: "Group B" }]);
});

describe("formatPageTitle", () => {
  it("names the page, the group and the church inside a group", () => {
    expect(formatPageTitle("Calendar", { group: "Group B", church: "Grace Church" })).toBe(
      "Calendar · Group B · Grace Church"
    );
  });

  it("names the page and the church elsewhere", () => {
    expect(formatPageTitle("Settings", { church: "Grace Church" })).toBe("Settings · Grace Church");
  });

  it("names two42, never a church or group, signed out", () => {
    expect(formatPageTitle("Sign in", { group: "Group B", church: null })).toBe("Sign in · two42");
  });
});

describe("pageTitle", () => {
  it("reads no church branding for a signed-out visitor", async () => {
    getOptionalUser.mockResolvedValue(null);
    expect(await pageTitle("Sign in")).toEqual({ title: "Sign in · two42" });
    expect(getRequestBranding).not.toHaveBeenCalled();
  });

  it("names the group the viewer is in", async () => {
    const generateMetadata = groupPageTitle("Calendar");
    expect(await generateMetadata({ params: Promise.resolve({ groupId: GROUP_B }) })).toEqual({
      title: "Calendar · Group B · Grace Church",
    });
  });

  it("leaves out a group the viewer is not in", async () => {
    expect(await pageTitle("Calendar", { groupId: GROUP_C })).toEqual({
      title: "Calendar · Grace Church",
    });
  });

  it("leaves out the group when the membership read fails", async () => {
    getGroupMemberships.mockRejectedValue(new Error("down"));
    expect(await pageTitle("Calendar", { groupId: GROUP_B })).toEqual({
      title: "Calendar · Grace Church",
    });
  });
});

describe("every page", () => {
  const appDir = path.join(__dirname, "..", "app");
  const pages = readdirSync(appDir, { recursive: true, encoding: "utf8" }).filter(
    (file) => path.basename(file) === "page.tsx"
  );

  it.each(pages)("%s takes its title from the helper", (file) => {
    const source = readFileSync(path.join(appDir, file), "utf8");
    expect(source).toMatch(/export (const|async function) generateMetadata\b/);
    expect(source).toMatch(/\b(groupPageTitle|pageTitle)\(/);
  });
});
