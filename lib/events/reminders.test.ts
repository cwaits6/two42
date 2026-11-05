import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  GROUP_REMINDER_ITEMS,
  groupReminders,
  isReminderDays,
  REMINDER_DAYS,
  REMINDER_ITEMS,
  reminderLabel,
} from "./reminders";
import { DAYS_BEFORE, REMINDER_FIRING_HOUR_UTC } from "@/supabase/functions/_shared/event-reminder-schedule";

const migration = readFileSync("supabase/migrations/20261117000000_event_reminder_choices.sql", "utf8");

const checkLists = new Map(
  [...migration.matchAll(/constraint (\w+) check \(\w+ in \(([\d, ]+)\)\)/g)].map(([, name, list]) => [name, list])
);

/** The values a check constraint in the migration allows. */
function allowed(constraint: string): number[] {
  const list = checkLists.get(constraint);
  if (!list) throw new Error(`No ${constraint} in the migration`);
  return list.split(",").map(Number).sort((a, b) => a - b);
}

describe("reminder choices", () => {
  it("offers exactly what the events column accepts", () => {
    expect([...REMINDER_DAYS].sort((a, b) => a - b)).toEqual(allowed("events_reminder_days_before_check"));
    expect(REMINDER_ITEMS.map((item) => Number(item.value))).toEqual([...REMINDER_DAYS]);
  });

  it("offers a group exactly what its default column accepts, which leaves out no reminder", () => {
    expect(GROUP_REMINDER_ITEMS.map((item) => Number(item.value)).sort((a, b) => a - b)).toEqual(
      allowed("group_settings_event_reminder_default_days_check")
    );
  });

  it("has the job send for every choice the events column accepts but no reminder", () => {
    expect([...DAYS_BEFORE].sort((a, b) => a - b)).toEqual(
      allowed("events_reminder_days_before_check").filter((days) => days !== 0)
    );
  });

  it("opens the job's day at the first hour the migration schedules it", () => {
    const schedule = /'send-event-reminders-daily',\s*'0 (\d+)-\d+ \* \* \*'/.exec(migration);
    expect(Number(schedule?.[1])).toBe(REMINDER_FIRING_HOUR_UTC);
  });

  it("names each choice", () => {
    expect(REMINDER_ITEMS.map((item) => item.label)).toEqual([
      "1 day before",
      "2 days before",
      "1 week before",
      "No reminder",
    ]);
    expect(reminderLabel(7)).toBe("1 week before");
  });

  it("tells a choice from any other number", () => {
    expect([0, 1, 2, 7].every(isReminderDays)).toBe(true);
    expect([3, -1, 14].some(isReminderDays)).toBe(false);
  });

  it("reads a group's settings", () => {
    expect(groupReminders({ event_reminders_enabled: false, event_reminder_default_days: 2 })).toEqual({
      enabled: false,
      defaultDays: 2,
    });
  });
});
