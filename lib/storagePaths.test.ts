// Unit tests for the org-partitioned storage key convention (CWA-57).
// Pure units: no network, no database — the builders are string assembly
// with loud failure on malformed segments, mirroring lib/branding.test.ts.

import { describe, expect, it } from "vitest";
import { orgObjectPath, relObjectPath, type StorageKind } from "@/lib/storagePaths";

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
