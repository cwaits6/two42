import { describe, expect, it } from "vitest";
import { COPY_SOURCES, copySourceFor } from "@/supabase/functions/_shared/records-providers";
import { listProviders } from "./providers";

// The nightly refresh finds a copy source by the stored provider id, apart from the app's list.
describe("the app's providers and the nightly refresh's copy sources", () => {
  it("give each provider the copy source the refresh would use for it", () => {
    for (const provider of listProviders()) expect(provider.copy ?? null, provider.id).toBe(copySourceFor(provider.id));
    expect(Object.keys(COPY_SOURCES).every((id) => listProviders().some((p) => p.id === id))).toBe(true);
  });
});
