// The verify route is hidden with the rest of the custom sending domain
// surface: it must 404 before touching auth, the database or Resend, and
// fall through to the normal admin gate once the flag is on.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireOrgAdmin = vi.fn();
vi.mock("@/lib/members/access", () => ({
  requireOrgAdmin: () => requireOrgAdmin(),
}));

const createServiceClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => createServiceClient(),
}));

const domainsVerify = vi.fn();
vi.mock("resend", () => ({
  Resend: class {
    domains = {
      verify: (...args: unknown[]) => domainsVerify(...args),
      get: vi.fn(),
    };
  },
}));

const sendingDomains = vi.hoisted(() => ({
  CUSTOM_SENDING_DOMAINS_ENABLED: true,
}));
vi.mock("@/lib/email/sendingDomains", () => sendingDomains);

const { POST } = await import("@/app/api/admin/email-domain/verify/route");

beforeEach(() => {
  requireOrgAdmin.mockReset();
  createServiceClient.mockReset();
  domainsVerify.mockReset();
});

afterEach(() => {
  sendingDomains.CUSTOM_SENDING_DOMAINS_ENABLED = true;
});

describe("POST /api/admin/email-domain/verify", () => {
  it("404s before auth or any data work while custom sending domains are off", async () => {
    sendingDomains.CUSTOM_SENDING_DOMAINS_ENABLED = false;

    const res = await POST();

    expect(res.status).toBe(404);
    expect(requireOrgAdmin).not.toHaveBeenCalled();
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(domainsVerify).not.toHaveBeenCalled();
  });

  it("reaches the admin gate once the flag is on", async () => {
    requireOrgAdmin.mockResolvedValue({ ok: false, status: 401 });

    const res = await POST();

    expect(res.status).toBe(401);
    expect(createServiceClient).not.toHaveBeenCalled();
  });
});
