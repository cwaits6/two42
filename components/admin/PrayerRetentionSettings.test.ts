// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/components/ui/select", () => import("@/components/ui/select.mock"));

const browser = vi.hoisted(() => ({
  result: null as unknown as { data: unknown[] | null; error: { message: string } | null },
  writes: [] as unknown[],
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      update: (values: unknown) => ({
        eq: () => ({
          select: async () => {
            browser.writes.push(values);
            return browser.result;
          },
        }),
      }),
    }),
  }),
}));

const { PrayerRetentionSettings, savePrayerRetention } = await import("./PrayerRetentionSettings");

type Result = { data: unknown[] | null; error: { message: string } | null };

function client(result: Result, calls: Record<string, unknown>) {
  return {
    from: (table: string) => ({
      update: (values: unknown) => ({
        eq: (column: string, value: unknown) => ({
          select: async () => {
            Object.assign(calls, { table, values, column, value });
            return result;
          },
        }),
      }),
    }),
  } as unknown as SupabaseClient<Database>;
}

describe("savePrayerRetention", () => {
  it("is not a save when the request throws", async () => {
    const throwing = {
      from: () => {
        throw new Error("network down");
      },
    } as unknown as Parameters<typeof savePrayerRetention>[0];
    expect(await savePrayerRetention(throwing, "org-1", 6)).toBe(false);
  });

  it("writes the months for a period, on the caller's own org", async () => {
    const calls: Record<string, unknown> = {};
    const ok = await savePrayerRetention(client({ data: [{}], error: null }, calls), "org-1", 12);
    expect(ok).toBe(true);
    expect(calls).toEqual({
      table: "organizations",
      values: { prayer_request_retention_months: 12 },
      column: "id",
      value: "org-1",
    });
  });

  it("writes null to turn it off", async () => {
    const calls: Record<string, unknown> = {};
    await savePrayerRetention(client({ data: [{}], error: null }, calls), "org-1", "off");
    expect(calls.values).toEqual({ prayer_request_retention_months: null });
  });

  it("is not a save when RLS filtered the row out", async () => {
    expect(await savePrayerRetention(client({ data: [], error: null }, {}), "org-1", 6)).toBe(false);
  });

  it("is not a save on an error", async () => {
    const failed = client({ data: null, error: { message: "refused" } }, {});
    expect(await savePrayerRetention(failed, "org-1", 6)).toBe(false);
  });
});

describe("PrayerRetentionSettings", () => {
  let root: Root;

  async function mount(retention: 6 | "off") {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(createElement(PrayerRetentionSettings, { orgId: "org-1", retention })));
  }

  // The confirmation renders after the control, so the last match is its button.
  async function click(name: string) {
    const found = [...document.querySelectorAll("button")].findLast((b) => b.textContent?.trim() === name);
    if (!found) throw new Error(`No button named ${name}`);
    await act(async () => found.click());
  }

  const asking = () => document.querySelector('[role="dialog"]')?.textContent ?? null;

  beforeEach(() => {
    browser.result = { data: [{}], error: null };
    browser.writes = [];
    toast.success.mockClear();
    toast.error.mockClear();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = "";
  });

  it("saves a period only once its deletion is confirmed", async () => {
    await mount("off");
    await click("Delete after 1 year");

    expect(browser.writes).toEqual([]);
    expect(asking()).toContain("Delete prayer requests after 1 year?");

    await click("Delete after 1 year");
    expect(browser.writes).toEqual([{ prayer_request_retention_months: 12 }]);
    expect(toast.success).toHaveBeenCalledWith("Prayer requests will be deleted after 1 year.");
    expect(asking()).toBeNull();
  });

  it("saves nothing when the question is cancelled", async () => {
    await mount("off");
    await click("Delete after 1 year");
    await click("Cancel");

    expect(browser.writes).toEqual([]);
    expect(asking()).toBeNull();
  });

  it("claims nothing and keeps the question open when the write matches no row", async () => {
    browser.result = { data: [], error: null };
    await mount("off");
    await click("Delete after 1 year");
    await click("Delete after 1 year");

    expect(toast.error).toHaveBeenCalledWith("Couldn't save the prayer request setting. Try again.");
    expect(toast.success).not.toHaveBeenCalled();
    expect(asking()).toContain("Delete prayer requests after 1 year?");
  });

  it("keeps prayer requests at once, with no question", async () => {
    await mount(6);
    await click("Keep prayer requests");

    expect(asking()).toBeNull();
    expect(browser.writes).toEqual([{ prayer_request_retention_months: null }]);
    expect(toast.success).toHaveBeenCalledWith("Prayer requests will be kept.");
  });

  it("neither asks nor writes when the period picked is the one in force", async () => {
    await mount(6);
    await click("Delete after 6 months");

    expect(asking()).toBeNull();
    expect(browser.writes).toEqual([]);
  });
});
