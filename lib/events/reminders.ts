import type { GroupSettings } from "@/lib/types";

/** What an event can hold in `reminder_days_before`; 0 sends none. */
export const REMINDER_DAYS = [1, 2, 7, 0] as const;
export type ReminderDays = (typeof REMINDER_DAYS)[number];

const LABELS: Record<ReminderDays, string> = {
  1: "1 day before",
  2: "2 days before",
  7: "1 week before",
  0: "No reminder",
};

// Select values are strings; the column is a number.
export const REMINDER_ITEMS = REMINDER_DAYS.map((days) => ({ value: String(days), label: LABELS[days] }));

/** A group's default for new events: any choice but none, which is the group's own switch. */
export const GROUP_REMINDER_ITEMS = REMINDER_ITEMS.filter((item) => item.value !== "0");

export function reminderLabel(days: number): string {
  return LABELS[days as ReminderDays] ?? LABELS[1];
}

export function isReminderDays(value: number): value is ReminderDays {
  return (REMINDER_DAYS as readonly number[]).includes(value);
}

/** What Add event and Edit event need of the group's reminder settings. */
export interface GroupReminders {
  enabled: boolean;
  defaultDays: number;
}

/** A group that has saved no settings, or whose settings couldn't be loaded, sends 1 day before. */
export const GROUP_REMINDERS_DEFAULT: GroupReminders = { enabled: true, defaultDays: 1 };

export function groupReminders(
  settings: Pick<GroupSettings, "event_reminders_enabled" | "event_reminder_default_days">
): GroupReminders {
  return { enabled: settings.event_reminders_enabled, defaultDays: settings.event_reminder_default_days };
}
