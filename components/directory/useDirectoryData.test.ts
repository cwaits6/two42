// Unit tests for signDirectoryUrls (CWA-59 / #333) — the highest-risk
// "flatten avatar URLs into one array, mint, then re-index into nested
// objects" instance this PR introduces: member avatars, each family's own
// photo_url, and two nested per-family lists (members, family_members_list)
// all share one flat urls array via a take() closure. What matters here is
// that reassembly lands each signed URL back on the exact slot it came
// from — because a mis-indexed batch would render the wrong person's photo.

import { describe, expect, it, vi } from "vitest";
import type { DirectoryProfile, FamilyDirectoryFull } from "@/lib/types";

vi.mock("@/lib/uploadImage", () => ({
  mintSignedUrls: async (urls: Array<string | null | undefined>) =>
    urls.map((u) => (u ? `signed:${u}` : null)),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({}),
}));

const { signDirectoryUrls } = await import("@/components/directory/useDirectoryData");

// Only the fields signDirectoryUrls touches (id, avatar_url) matter here —
// cast through unknown rather than filling out every unrelated column of
// the real DirectoryProfile/FamilyDirectoryFull/HouseholdMember shapes.
function member(id: string, avatarUrl: string | null) {
  return { id, avatar_url: avatarUrl } as unknown as DirectoryProfile;
}

function familyMember(id: string, avatarUrl: string | null) {
  return { id, avatar_url: avatarUrl } as unknown as FamilyDirectoryFull["members"][number];
}

function familyMembersListEntry(id: string, avatarUrl: string | null) {
  return {
    id,
    avatar_url: avatarUrl,
  } as unknown as FamilyDirectoryFull["family_members_list"][number];
}

function family(
  id: string,
  photoUrl: string | null,
  members: FamilyDirectoryFull["members"],
  familyMembersList: FamilyDirectoryFull["family_members_list"],
): FamilyDirectoryFull {
  return {
    id,
    photo_url: photoUrl,
    members,
    family_members_list: familyMembersList,
  } as unknown as FamilyDirectoryFull;
}

describe("signDirectoryUrls", () => {
  it("reassembles member avatars, family photos, and nested member lists into the right slots", async () => {
    const members = [member("m1", "url-m1"), member("m2", null)];
    const families = [
      family(
        "f1",
        "url-f1",
        [familyMember("fm1", "url-fm1")],
        [familyMembersListEntry("fml1", "url-fml1")],
      ),
    ];

    const result = await signDirectoryUrls(members, families);

    expect(result.members[0].avatar_url).toBe("signed:url-m1");
    expect(result.members[1].avatar_url).toBeNull();
    expect(result.families[0].photo_url).toBe("signed:url-f1");
    expect(result.families[0].members[0].avatar_url).toBe("signed:url-fm1");
    expect(result.families[0].family_members_list[0].avatar_url).toBe("signed:url-fml1");
  });

  it("does not cross-contaminate slots across multiple families", async () => {
    const members = [member("m1", "url-m1")];
    const families = [
      family(
        "f1",
        "url-f1-photo",
        [familyMember("f1-a", "url-f1-a"), familyMember("f1-b", "url-f1-b")],
        [familyMembersListEntry("f1-c", "url-f1-c")],
      ),
      family(
        "f2",
        "url-f2-photo",
        [familyMember("f2-a", "url-f2-a")],
        [
          familyMembersListEntry("f2-b", "url-f2-b"),
          familyMembersListEntry("f2-c", "url-f2-c"),
        ],
      ),
    ];

    const result = await signDirectoryUrls(members, families);

    expect(result.families[0].photo_url).toBe("signed:url-f1-photo");
    expect(result.families[0].members.map((m) => m.avatar_url)).toEqual([
      "signed:url-f1-a",
      "signed:url-f1-b",
    ]);
    expect(result.families[0].family_members_list.map((m) => m.avatar_url)).toEqual([
      "signed:url-f1-c",
    ]);

    expect(result.families[1].photo_url).toBe("signed:url-f2-photo");
    expect(result.families[1].members.map((m) => m.avatar_url)).toEqual([
      "signed:url-f2-a",
    ]);
    expect(result.families[1].family_members_list.map((m) => m.avatar_url)).toEqual([
      "signed:url-f2-b",
      "signed:url-f2-c",
    ]);
  });

  it("handles families with no photo and empty member lists", async () => {
    const families = [family("f1", null, [], [])];

    const result = await signDirectoryUrls([], families);

    expect(result.families[0].photo_url).toBeNull();
    expect(result.families[0].members).toEqual([]);
    expect(result.families[0].family_members_list).toEqual([]);
  });

  it("returns empty collections for no input", async () => {
    const result = await signDirectoryUrls([], []);
    expect(result.members).toEqual([]);
    expect(result.families).toEqual([]);
  });
});
