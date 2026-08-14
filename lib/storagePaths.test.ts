// Unit tests for the org-partitioned storage key convention (CWA-57).
// Pure units: no network, no database — the builders are string assembly
// with loud failure on malformed segments, mirroring lib/branding.test.ts.

import { describe, expect, it } from "vitest";
import {
  groupPathsByBucket,
  orgObjectPath,
  parseStoragePublicUrl,
  relObjectPath,
  type StorageKind,
} from "@/lib/storagePaths";

const ORG = "11111111-1111-1111-1111-111111111111";
const ENTITY = "22222222-2222-2222-2222-222222222222";

describe("relObjectPath", () => {
  it("builds the <kind>/<entityId>/<file> key for each kind", () => {
    const cases: Array<[StorageKind, string]> = [
      ["profiles", `profiles/${ENTITY}/avatar`],
      ["family-members", `family-members/${ENTITY}/avatar`],
      ["families", `families/${ENTITY}/photo`],
      ["events", `events/${ENTITY}/cover`],
    ];
    for (const [kind, expected] of cases) {
      const file = expected.split("/")[2];
      expect(relObjectPath(kind, ENTITY, file)).toBe(expected);
    }
  });

  it("throws on an empty or whitespace entityId", () => {
    expect(() => relObjectPath("profiles", "", "avatar")).toThrow(/entityId/);
    expect(() => relObjectPath("profiles", "   ", "avatar")).toThrow(/entityId/);
  });

  it("throws on an empty file segment", () => {
    expect(() => relObjectPath("families", ENTITY, "")).toThrow(/file/);
  });

  it('throws on a segment containing "/"', () => {
    expect(() => relObjectPath("profiles", `${ENTITY}/extra`, "avatar")).toThrow(/entityId/);
    expect(() => relObjectPath("profiles", ENTITY, "a/b")).toThrow(/file/);
  });
});

describe("orgObjectPath", () => {
  it("puts the org at index 0 of the key — the segment the RLS floor checks", () => {
    const full = orgObjectPath(ORG, relObjectPath("profiles", ENTITY, "avatar"));
    expect(full).toBe(`${ORG}/profiles/${ENTITY}/avatar`);
    expect(full.split("/")[0]).toBe(ORG);
  });

  it("builds the full key for each of the four kinds", () => {
    expect(orgObjectPath(ORG, relObjectPath("families", ENTITY, "photo"))).toBe(
      `${ORG}/families/${ENTITY}/photo`,
    );
    expect(orgObjectPath(ORG, relObjectPath("family-members", ENTITY, "avatar"))).toBe(
      `${ORG}/family-members/${ENTITY}/avatar`,
    );
    expect(orgObjectPath(ORG, relObjectPath("events", ENTITY, "cover"))).toBe(
      `${ORG}/events/${ENTITY}/cover`,
    );
  });

  it("throws on an empty or whitespace orgId", () => {
    expect(() => orgObjectPath("", "profiles/x/avatar")).toThrow(/orgId/);
    expect(() => orgObjectPath("  ", "profiles/x/avatar")).toThrow(/orgId/);
  });

  it('throws on an orgId containing "/"', () => {
    expect(() => orgObjectPath(`${ORG}/`, "profiles/x/avatar")).toThrow(/orgId/);
  });
});

describe("parseStoragePublicUrl", () => {
  const KEY = `${ORG}/profiles/${ENTITY}/avatar.jpg`;

  it("recovers {bucket, path} from a local-stack public URL", () => {
    expect(
      parseStoragePublicUrl(
        `http://127.0.0.1:54321/storage/v1/object/public/avatars/${KEY}`,
      ),
    ).toEqual({ bucket: "avatars", path: KEY });
  });

  it("is host-agnostic — a prod-shaped URL parses identically", () => {
    expect(
      parseStoragePublicUrl(
        `https://abcdefghijkl.supabase.co/storage/v1/object/public/event-images/${ORG}/events/${ENTITY}/cover.jpg`,
      ),
    ).toEqual({
      bucket: "event-images",
      path: `${ORG}/events/${ENTITY}/cover.jpg`,
    });
  });

  it("drops a query-string suffix (legacy ?t= cache-busted values)", () => {
    expect(
      parseStoragePublicUrl(
        `http://127.0.0.1:54321/storage/v1/object/public/avatars/${KEY}?t=1712345678`,
      ),
    ).toEqual({ bucket: "avatars", path: KEY });
  });

  it("returns null for empty, foreign, and unrelated-bucket URLs", () => {
    expect(parseStoragePublicUrl("")).toBeNull();
    expect(parseStoragePublicUrl("https://example.com/x.jpg")).toBeNull();
    expect(
      parseStoragePublicUrl(
        `http://127.0.0.1:54321/storage/v1/object/public/other-bucket/${KEY}`,
      ),
    ).toBeNull();
    // A signed URL is not a public URL — re-signing an already-signed value
    // must fail soft rather than mint garbage.
    expect(
      parseStoragePublicUrl(
        `http://127.0.0.1:54321/storage/v1/object/sign/avatars/${KEY}?token=x`,
      ),
    ).toBeNull();
  });
});

describe("groupPathsByBucket", () => {
  const BASE = "http://127.0.0.1:54321/storage/v1/object/public";
  const AVATAR_KEY = `${ORG}/profiles/${ENTITY}/avatar.jpg`;
  const EVENT_KEY = `${ORG}/events/${ENTITY}/cover.jpg`;

  it("groups by bucket and preserves original input indices", () => {
    const groups = groupPathsByBucket([
      `${BASE}/avatars/${AVATAR_KEY}`, // 0
      null, // 1
      `${BASE}/event-images/${EVENT_KEY}`, // 2
      undefined, // 3
      "https://example.com/foreign.jpg", // 4
      `${BASE}/avatars/${AVATAR_KEY}`, // 5
    ]);
    expect(groups.get("avatars")).toEqual({
      indices: [0, 5],
      paths: [AVATAR_KEY, AVATAR_KEY],
    });
    expect(groups.get("event-images")).toEqual({
      indices: [2],
      paths: [EVENT_KEY],
    });
    expect(groups.size).toBe(2);
  });

  it("returns an empty map when nothing parses", () => {
    expect(groupPathsByBucket([null, undefined, "", "https://example.com/x"]).size).toBe(0);
  });
});
