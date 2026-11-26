import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createServiceClient: vi.fn() }));

import { recordsChildPhotoKey, recordsPhotoKey } from "@/supabase/functions/_shared/records-photo";
import { recordsChildPhotoPath, recordsPhotoPath } from "./photo";

describe("recordsPhotoPath", () => {
  it("is the key the nightly refresh stores the photo under", () => {
    const org = "7c0d3a52-5b6e-4f1a-9d2c-1e8f4a6b9c01";
    const profile = "2b6f0c9e-1d4a-4e8b-a5c3-9f7e6d5c4b3a";
    expect(recordsPhotoPath(org, profile)).toBe(`${org}/profiles/${profile}/records-photo.jpg`);
    expect(recordsPhotoPath(org, profile)).toBe(recordsPhotoKey(org, profile));
  });

  it("builds a child's photo key the way the nightly refresh does", () => {
    const org = "7c0d3a52-5b6e-4f1a-9d2c-1e8f4a6b9c01";
    const member = "2b6f0c9e-1d4a-4e8b-a5c3-9f7e6d5c4b3a";
    expect(recordsChildPhotoPath(org, member)).toBe(`${org}/family-members/${member}/records-photo.jpg`);
    expect(recordsChildPhotoPath(org, member)).toBe(recordsChildPhotoKey(org, member));
  });
});
