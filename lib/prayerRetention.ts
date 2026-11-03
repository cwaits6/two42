// The periods match the column's CHECK and PRAYER_RETENTION_MONTHS in
// supabase/functions/_shared/retention.ts; a new one lands on all three.
export const PRAYER_RETENTION_PERIODS = {
  6: "6 months",
  12: "1 year",
  24: "2 years",
} as const;

export type PrayerRetentionMonths = keyof typeof PRAYER_RETENTION_PERIODS;

/** What the setting holds: the column's null reads as "off". */
export type PrayerRetention = PrayerRetentionMonths | "off";

export function isPrayerRetentionMonths(value: unknown): value is PrayerRetentionMonths {
  return value === 6 || value === 12 || value === 24;
}

export const PRAYER_RETENTION_OPTIONS: { value: string; label: string }[] = [
  { value: "off", label: "Keep prayer requests" },
  ...([6, 12, 24] as const).map((months) => ({
    value: String(months),
    label: `Delete after ${PRAYER_RETENTION_PERIODS[months]}`,
  })),
];

/**
 * What a church admin agrees to before the setting takes effect. The job goes by
 * created_at, so an edit or an answered mark does not buy a request more time.
 */
export function prayerRetentionConfirmation(months: PrayerRetentionMonths): {
  title: string;
  description: string;
  confirmLabel: string;
} {
  const period = PRAYER_RETENTION_PERIODS[months];
  return {
    title: `Delete prayer requests after ${period}?`,
    description:
      `Tonight, every prayer request in your church posted more than ${period} ago will be ` +
      `permanently deleted, along with its prayer responses. After that, each one will be ` +
      `deleted when it reaches ${period}, even if it was edited or marked answered. Deleted ` +
      `prayer requests can't be brought back.`,
    confirmLabel: `Delete after ${period}`,
  };
}
