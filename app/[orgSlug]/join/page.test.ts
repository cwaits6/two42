// Pins that the path slug is the only org anchor on the anonymous join page:
// it reaches createClient() only after the shape gate, a slug resolving no
// org fails closed, and the canonical tag names the canonical host.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { siteConfig } from "@/lib/config";

const rpc = vi.fn();
const createClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: (orgSlug?: string) => createClient(orgSlug),
}));

const getOptionalUser = vi.fn();
vi.mock("@/lib/supabase/current-user", () => ({
  getOptionalUser: () => getOptionalUser(),
}));

vi.mock("@/app/join/JoinForm", () => ({ JoinForm: () => null }));
vi.mock("@/app/join/JoinUnavailable", () => ({ JoinUnavailable: () => null }));

const { JoinForm } = await import("@/app/join/JoinForm");
const { JoinUnavailable } = await import("@/app/join/JoinUnavailable");
const { default: OrgJoinPage, generateMetadata } = await import("./page");

beforeEach(() => {
  rpc.mockReset();
  createClient.mockReset();
  createClient.mockResolvedValue({ rpc });
  getOptionalUser.mockReset();
  getOptionalUser.mockResolvedValue(null);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("OrgJoinPage", () => {
  it("resolves the org through a client scoped to the path slug", async () => {
    rpc.mockResolvedValue({ data: "org-grace", error: null });

    const element = await OrgJoinPage({ params: Promise.resolve({ orgSlug: "grace" }) });

    expect(createClient).toHaveBeenCalledWith("grace");
    expect(rpc).toHaveBeenCalledWith("app_request_org_id");
    expect(element.type).toBe(JoinForm);
    expect(element.props).toEqual({ orgId: "org-grace", orgSlug: "grace" });
  });

  it("never builds a client for a malformed slug", async () => {
    const element = await OrgJoinPage({
      params: Promise.resolve({ orgSlug: "grace\r\nx-injected: 1" }),
    });

    expect(createClient).not.toHaveBeenCalled();
    expect(element.type).toBe(JoinUnavailable);
  });

  it("renders the unavailable page when the slug resolves no org", async () => {
    rpc.mockResolvedValue({ data: null, error: null });

    const element = await OrgJoinPage({ params: Promise.resolve({ orgSlug: "grace" }) });

    expect(element.type).toBe(JoinUnavailable);
  });

  it("renders the unavailable page when org resolution errors", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });

    const element = await OrgJoinPage({ params: Promise.resolve({ orgSlug: "grace" }) });

    expect(element.type).toBe(JoinUnavailable);
  });
});

describe("generateMetadata", () => {
  it("points the canonical tag at the path-based join URL on the canonical host", async () => {
    const metadata = await generateMetadata({ params: Promise.resolve({ orgSlug: "grace" }) });

    expect(metadata.alternates).toEqual({ canonical: `${siteConfig.url}/grace/join` });
  });

  it("emits no canonical tag for a malformed slug", async () => {
    const metadata = await generateMetadata({ params: Promise.resolve({ orgSlug: "../etc" }) });

    expect(metadata.alternates).toBeUndefined();
  });
});
