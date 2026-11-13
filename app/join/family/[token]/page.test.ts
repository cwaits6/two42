import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CHURCH_ADMIN_INVALID_HELP, INVITE_INVALID_TITLE } from "@/lib/groups/invites";

const lookup = vi.fn();
const createServiceClient = vi.fn(async () => ({
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => lookup() }) }) }),
}));
const profileLookup = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => createServiceClient(),
  createClient: async () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => profileLookup() }) }) }),
  }),
}));
const currentUser = vi.fn();
vi.mock("@/lib/supabase/current-user", () => ({ getOptionalUser: () => currentUser() }));
vi.mock("./JoinHouseholdButton", () => ({ JoinHouseholdButton: () => "[join household]" }));
vi.mock("@/app/join/[token]/SignOutButton", () => ({ SignOutButton: () => "[sign out]" }));
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
  family_id: "fam-1",
  invite_email: "mia@example.test",
  accepted_at: null,
  family_member_id: "member-1",
  family_members: { first_name: "Mia", last_name: "Fakeworth", family_id: "fam-1", claimed_profile_id: null },
  family_units: { family_name: "Fakeworth" },
};
const MIA = { id: "user-1", email: "Mia@Example.test" };
const PROFILE = { org_id: "org-1", role: "member", family_id: null };

beforeEach(() => {
  lookup.mockReset();
  profileLookup.mockReset();
  currentUser.mockReset();
  currentUser.mockResolvedValue(null);
  createServiceClient.mockClear();
});

describe("FamilyJoinPage", () => {
  it("shows the invalid-invite state for a malformed link without looking it up", async () => {
    const html = await render("not-a-link");

    expect(html).toContain(INVITE_INVALID_TITLE);
    expect(html).toContain(CHURCH_ADMIN_INVALID_HELP);
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

  it("offers Sign in that returns to the invite", async () => {
    lookup.mockResolvedValueOnce({ data: liveRow, error: null });

    const html = await render(LIVE_TOKEN);

    expect(html).toContain(`href="/login?redirect=${encodeURIComponent(`/join/family/${LIVE_TOKEN}`)}"`);
  });
});

describe("FamilyJoinPage signed in", () => {
  async function renderSignedIn(opts: {
    user?: typeof MIA;
    profile?: Record<string, unknown> | null;
    row?: typeof liveRow;
  }) {
    currentUser.mockResolvedValue(opts.user ?? MIA);
    lookup.mockResolvedValueOnce({ data: opts.row ?? liveRow, error: null });
    profileLookup.mockResolvedValueOnce({ data: opts.profile === undefined ? PROFILE : opts.profile, error: null });
    return render(LIVE_TOKEN);
  }

  it("shows the Join this household step naming the household", async () => {
    const html = await renderSignedIn({});

    expect(html).toContain("Join this household");
    expect(html).toContain("Fakeworth household");
    expect(html).toContain("[join household]");
    expect(html).not.toContain("A church admin reviews each request");
  });

  it.each([
    ["another address", { user: { ...MIA, email: "leo@example.test" } }],
    ["another church", { profile: { ...PROFILE, org_id: "org-2" } }],
  ])("refuses %s with the different-account message", async (_, opts) => {
    const html = await renderSignedIn(opts);

    expect(html).toContain("This link is for a different account");
    expect(html).toContain("[sign out]");
    expect(html).not.toContain("[join household]");
  });

  it("refuses someone already in another household", async () => {
    const html = await renderSignedIn({ profile: { ...PROFILE, family_id: "fam-other" } });

    expect(html).toContain("You're already in a household");
    expect(html).not.toContain("[join household]");
  });

  it("shows the invalid-link message when the invited member moved", async () => {
    const html = await renderSignedIn({
      row: { ...liveRow, family_members: { ...liveRow.family_members, family_id: "fam-other" } },
    });

    expect(html).toContain(INVITE_INVALID_TITLE);
    expect(html).not.toContain("[join household]");
  });

  it("offers a retry when the viewer's profile cannot be read", async () => {
    currentUser.mockResolvedValue(MIA);
    lookup.mockResolvedValueOnce({ data: liveRow, error: null });
    profileLookup.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    vi.spyOn(console, "error").mockImplementationOnce(() => {});

    expect(await render(LIVE_TOKEN)).toContain("Couldn't load this invite.");
  });
});
