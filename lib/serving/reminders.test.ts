import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MAX_BLOCK_YEARS, MAX_EXTRA_WEEKS, MAX_WINDOW_WEEKS } from "./dates";
import {
  DEFAULT_SEND_HOUR as JOB_DEFAULT_SEND_HOUR,
  FIRST_SEND_HOUR as JOB_FIRST_SEND_HOUR,
  LAST_SEND_HOUR as JOB_LAST_SEND_HOUR,
} from "@/supabase/functions/_shared/serving-due";
import {
  DEFAULT_SEND_HOUR,
  FIRST_SEND_HOUR,
  LAST_SEND_HOUR,
  SEND_HOUR_OPTIONS,
  formatSendHour,
} from "./reminders";

describe("the send time the dialog offers", () => {
  it("agrees with the hourly job on the default and the range", () => {
    expect(DEFAULT_SEND_HOUR).toBe(JOB_DEFAULT_SEND_HOUR);
    expect(FIRST_SEND_HOUR).toBe(JOB_FIRST_SEND_HOUR);
    expect(LAST_SEND_HOUR).toBe(JOB_LAST_SEND_HOUR);
  });

  it("runs from 6:00 AM to 9:00 PM with no Default option", () => {
    expect(SEND_HOUR_OPTIONS[0]).toEqual({ value: "6", label: "6:00 AM" });
    expect(SEND_HOUR_OPTIONS.at(-1)).toEqual({ value: "21", label: "9:00 PM" });
    expect(SEND_HOUR_OPTIONS).toHaveLength(16);
    expect(SEND_HOUR_OPTIONS.some((o) => /default/i.test(o.label))).toBe(false);
  });

  it("formats noon and the default hour", () => {
    expect(formatSendHour(12)).toBe("12:00 PM");
    expect(formatSendHour(DEFAULT_SEND_HOUR)).toBe("9:00 AM");
  });
});

describe("the settings the database accepts", () => {
  // The CHECK constraints are literals; the app and the job hold the same
  // numbers as constants. Reading the migration text ties them together.
  const migration = readFileSync(
    "supabase/migrations/20261116000000_serving_blocks_couples_reminder_time.sql",
    "utf8",
  );
  const schedule = readFileSync("supabase/migrations/20260705000000_serving_schedule.sql", "utf8");

  it("match the hours the dialog offers", () => {
    expect(migration).toContain(`check (send_hour between ${FIRST_SEND_HOUR} and ${LAST_SEND_HOUR})`);
  });

  it("match the more-weeks, window and block limits the app enforces", () => {
    expect(migration).toContain(`check (extra_weeks between 0 and ${MAX_EXTRA_WEEKS})`);
    expect(migration).toContain(`date_to <= (date_from + interval '${MAX_BLOCK_YEARS} year')::date`);
    expect(schedule).toContain(`window_weeks between 1 and ${MAX_WINDOW_WEEKS}`);
  });
});
