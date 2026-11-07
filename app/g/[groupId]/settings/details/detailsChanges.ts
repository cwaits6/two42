import type { GroupSharingColumns } from "@/lib/calendar/sharing";
import type { GroupReminders } from "@/lib/events/reminders";
import { validateGroupColor, type GroupSettingsValues } from "@/lib/groups/settings";

export type CalendarSetting = keyof GroupSharingColumns;

export type DetailsFields = {
  color: string;
  calendar: Record<CalendarSetting, boolean>;
  reminders: GroupReminders;
};

/** The group_settings columns a Save writes; each is present only when it changed. */
export type SettingsChanges = Partial<
  Pick<GroupSettingsValues, CalendarSetting | "event_reminders_enabled" | "event_reminder_default_days">
>;

export type DetailsChanges = { color?: string; settings?: SettingsChanges };

export function colorError(color: string): string | undefined {
  return validateGroupColor(color).ok
    ? undefined
    : "Choose a darker or lighter color, so text on it stays easy to read.";
}

/** What differs from what is saved, by where it is written. */
export function detailsChanges(saved: DetailsFields, draft: DetailsFields): DetailsChanges {
  const changes: DetailsChanges = {};
  if (draft.color !== saved.color) changes.color = draft.color;
  const settings: SettingsChanges = {};
  for (const key of Object.keys(draft.calendar) as CalendarSetting[]) {
    if (draft.calendar[key] !== saved.calendar[key]) settings[key] = draft.calendar[key];
  }
  if (draft.reminders.enabled !== saved.reminders.enabled) {
    settings.event_reminders_enabled = draft.reminders.enabled;
  }
  if (draft.reminders.defaultDays !== saved.reminders.defaultDays) {
    settings.event_reminder_default_days = draft.reminders.defaultDays;
  }
  if (Object.keys(settings).length > 0) changes.settings = settings;
  return changes;
}
