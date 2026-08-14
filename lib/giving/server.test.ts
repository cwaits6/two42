// Unit tests for signStewardAvatars (CWA-59 / #333). Unlike the named-slot
// reassembly in components/directory/useDirectoryData.ts, this helper uses
// fixed 2-slot stride arithmetic (i * 2 / i * 2 + 1) — the risk being
// guarded against is that stride drifts out of sync with the flatten if a
// third avatar field is ever added.

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/storageRead", () => ({
  mintSignedUrls: async (urls: Array<string | null | undefined>) =>
    urls.map((u) => (u ? `signed:${u}` : null)),
}));

const { signStewardAvatars } = await import("@/lib/giving/server");

function steward(id: string, avatarUrl: string | null) {
  return {
    id,
    first_name: id,
    last_name: null,
    preferred_name: null,
    avatar_url: avatarUrl,
  };
}

describe("signStewardAvatars", () => {
  it("signs each fund's steward and co_steward avatars into the right slots", async () => {
    const funds = [
      { id: "f1", steward: steward("s1", "url-s1"), co_steward: steward("c1", "url-c1") },
      { id: "f2", steward: steward("s2", "url-s2"), co_steward: null },
    ];

    const result = await signStewardAvatars(funds);

    expect(result[0].steward?.avatar_url).toBe("signed:url-s1");
    expect(result[0].co_steward?.avatar_url).toBe("signed:url-c1");
    expect(result[1].steward?.avatar_url).toBe("signed:url-s2");
    expect(result[1].co_steward).toBeNull();
  });

  it("does not cross-contaminate slots across multiple funds", async () => {
    const funds = [
      { id: "f1", steward: steward("s1", "url-f1-steward"), co_steward: steward("c1", "url-f1-co") },
      { id: "f2", steward: steward("s2", "url-f2-steward"), co_steward: steward("c2", "url-f2-co") },
      { id: "f3", steward: steward("s3", "url-f3-steward"), co_steward: null },
    ];

    const result = await signStewardAvatars(funds);

    expect(result[0].steward?.avatar_url).toBe("signed:url-f1-steward");
    expect(result[0].co_steward?.avatar_url).toBe("signed:url-f1-co");
    expect(result[1].steward?.avatar_url).toBe("signed:url-f2-steward");
    expect(result[1].co_steward?.avatar_url).toBe("signed:url-f2-co");
    expect(result[2].steward?.avatar_url).toBe("signed:url-f3-steward");
    expect(result[2].co_steward).toBeNull();
  });

  it("leaves steward/co_steward null when the fund has none", async () => {
    const funds = [{ id: "f1", steward: null, co_steward: null }];

    const result = await signStewardAvatars(funds);

    expect(result[0].steward).toBeNull();
    expect(result[0].co_steward).toBeNull();
  });

  it("returns an empty array for no funds without minting anything", async () => {
    expect(await signStewardAvatars([])).toEqual([]);
  });
});
