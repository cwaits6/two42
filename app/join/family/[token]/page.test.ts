import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { INVITE_INVALID_TITLE } from "@/lib/groups/invites";
import { HOUSEHOLD_INVITE_INVALID_HELP } from "./copy";

const lookup = vi.fn();
const createServiceClient = vi.fn(async () => ({
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => lookup() }) }) }),
}));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: () => createServiceClient() }));
vi.mock("@/lib/pageTitle", () => ({ pageTitle: async () => ({}) }));
vi.mock("@/components/states/ErrorState", () => ({
  ErrorState: ({ thing }: { thing: string }) => `Couldn't load ${thing}.`,
}));

const { default: FamilyJoinPage } = await import("./page");

const LIVE_TOKEN = "5c4ee000-0000-4000-8000-000000000002";

async function render(token: string): Promise<string> {
  const page = await FamilyJoinPage({ params: Promise.resolve({ token }) });
  return renderToStaticMarkup(page as ReactElement).replaceAll("&#x27;", "'");
}

const liveRow = {
  id: "invite-1",
  org_id: "org-1",
  invite_email: "mia@example.test",
  accepted_at: null,
  family_member_id: "member-1",
  family_members: { first_name: "Mia", last_name: "Fakeworth" },
  family_units: { family_name: "Fakeworth" },
};

beforeEach(() => {
  lookup.mockReset();
  createServiceClient.mockClear();
});

describe("FamilyJoinPage", () => {
  it("shows the invalid-invite state for a malformed link without looking it up", async () => {
    const html = await render("not-a-link");

    expect(html).toContain(INVITE_INVALID_TITLE);
    expect(html).toContain(HOUSEHOLD_INVITE_INVALID_HELP);
    expect(html).toContain('href="/login"');
    expect(html).not.toContain("Couldn't load");
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("words a malformed, unknown and already-used link identically", async () => {
    const malformed = await render("not-a-link");
    lookup.mockResolvedValueOnce({ data: null, error: null });
    const unknown = await render(LIVE_TOKEN);
    lookup.mockResolvedValueOnce({
      data: { ...liveRow, accepted_at: "2026-10-01T00:00:00Z" },
      error: null,
    });
    const used = await render(LIVE_TOKEN);

    expect(unknown).toBe(malformed);
    expect(used).toBe(malformed);
  });

  it("offers a retry, not the invalid state, when the lookup fails", async () => {
    lookup.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    vi.spyOn(console, "error").mockImplementationOnce(() => {});

    const html = await render(LIVE_TOKEN);

    expect(html).toContain("Couldn't load this invite.");
    expect(html).not.toContain(INVITE_INVALID_TITLE);
  });

  it("names the household and who reviews the request on a live link", async () => {
    lookup.mockResolvedValueOnce({ data: liveRow, error: null });

    const html = await render(LIVE_TOKEN);

    expect(html).toContain("Household invite");
    expect(html).toContain("Mia Fakeworth");
    expect(html).toContain("Fakeworth household");
    expect(html).toContain("A church admin reviews each request");
    expect(html).toContain('value="mia@example.test"');
  });
});
