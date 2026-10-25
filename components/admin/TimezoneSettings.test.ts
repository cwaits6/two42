import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { US_TIME_ZONES, saveTimeZone, timeZoneLabel, timeZoneOptions } from "./TimezoneSettings";

// A fixed summer instant: New York is UTC-04:00, Phoenix never changes.
const JULY = DateTime.fromISO("2026-07-01T12:00:00Z");

describe("timeZoneLabel", () => {
  it("names the zone with its UTC offset at that moment", () => {
    expect(timeZoneLabel("America/New_York", JULY)).toBe("America/New_York (UTC-04:00)");
    expect(timeZoneLabel("America/Phoenix", JULY)).toBe("America/Phoenix (UTC-07:00)");
    expect(timeZoneLabel("Asia/Kolkata", JULY)).toBe("Asia/Kolkata (UTC+05:30)");
    expect(timeZoneLabel("America/New_York", DateTime.fromISO("2026-12-01T12:00:00Z"))).toBe(
      "America/New_York (UTC-05:00)"
    );
  });
});

describe("timeZoneOptions", () => {
  it("lists the US zones first, then every other zone Intl knows, once each", () => {
    const options = timeZoneOptions("America/New_York", JULY);
    const values = options.map((o) => o.value);
    expect(values.slice(0, US_TIME_ZONES.length)).toEqual(US_TIME_ZONES);
    expect(new Set(values).size).toBe(values.length);
    expect(values).toContain("Europe/London");
    expect(values).toContain("Asia/Tokyo");
    expect(options[0].label).toBe("America/New_York (UTC-04:00)");
  });

  it("keeps the current zone listed even when the runtime's list lacks it", () => {
    const values = timeZoneOptions("UTC", JULY).map((o) => o.value);
    expect(values[0]).toBe("UTC");
    expect(values.filter((v) => v === "UTC")).toHaveLength(1);
  });
});

describe("saveTimeZone", () => {
  type Result = { data: { timezone: string }[] | null; error: { message: string } | null };

  function client(result: Result, calls: Record<string, unknown>) {
    return {
      from: (table: string) => {
        calls.table = table;
        return {
          update: (values: unknown) => {
            calls.values = values;
            return {
              eq: (column: string, value: string) => {
                calls.eq = [column, value];
                return { select: () => Promise.resolve(result) };
              },
            };
          },
        };
      },
    } as unknown as SupabaseClient<Database>;
  }

  it("is a save only when the update returns the row", async () => {
    const calls: Record<string, unknown> = {};
    const ok = await saveTimeZone(
      client({ data: [{ timezone: "America/Chicago" }], error: null }, calls),
      "org-1",
      "America/Chicago"
    );
    expect(ok).toBe(true);
    expect(calls).toEqual({
      table: "organizations",
      values: { timezone: "America/Chicago" },
      eq: ["id", "org-1"],
    });
  });

  it("treats zero returned rows as a failure, since a filtered update reports success", async () => {
    expect(await saveTimeZone(client({ data: [], error: null }, {}), "org-1", "America/Chicago")).toBe(false);
    expect(await saveTimeZone(client({ data: null, error: null }, {}), "org-1", "America/Chicago")).toBe(false);
  });

  it("treats an error as a failure", async () => {
    expect(
      await saveTimeZone(client({ data: null, error: { message: "boom" } }, {}), "org-1", "America/Chicago")
    ).toBe(false);
  });
});
