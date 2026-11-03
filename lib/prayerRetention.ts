// The column's CHECK and the job's PRAYER_RETENTION_MONTHS hold the same periods
// across build boundaries this table can't reach; the test here keeps them equal.
export const PRAYER_RETENTION_PERIODS = {
  6: "6 months",
  12: "1 year",
  24: "2 years",
} as const;

export type PrayerRetentionMonths = keyof typeof PRAYER_RETENTION_PERIODS;

/** What the setting holds: the column's null reads as "off". */
export type PrayerRetention = PrayerRetentionMonths | "off";

const PRAYER_RETENTION_MONTHS = Object.keys(PRAYER_RETENTION_PERIODS).map(Number) as PrayerRetentionMonths[];

export function isPrayerRetentionMonths(value: unknown): value is PrayerRetentionMonths {
  return PRAYER_RETENTION_MONTHS.some((months) => months === value);
}

/** Reads a select option's value; anything but an offered period is "off". */
export function parsePrayerRetention(value: string): PrayerRetention {
  const months = Number(value);
  return isPrayerRetentionMonths(months) ? months : "off";
}

export const PRAYER_RETENTION_OPTIONS: { value: string; label: string }[] = [
  { value: "off", label: "Keep prayer requests" },
  ...PRAYER_RETENTION_MONTHS.map((months) => ({
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
