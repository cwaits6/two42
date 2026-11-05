// The two values the reminder job shares with the migration that schedules
// it. lib/events/reminders.test.ts reads both sides and fails when they
// disagree.
//
// Import-free, so the app's test runner can load it too.

/** The first hour of the job's cron schedule, which opens each cycle. */
export const REMINDER_FIRING_HOUR_UTC = 15;

/** The choices an event can hold besides 0, "No reminder". */
export const DAYS_BEFORE = [1, 2, 7];
