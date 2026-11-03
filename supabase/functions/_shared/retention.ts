// The date rules for the nightly cleanup. A row is expired once its anchor
// moment is strictly older than the cutoff, so a row exactly on the cutoff
// waits for the next run.

const DAY_MS = 86_400_000;

export const EXPIRED_RETENTION_DAYS = 90;
export const FEEDBACK_RETENTION_MONTHS = 12;
export const PRAYER_RETENTION_MONTHS = [6, 12, 24] as const;

export function daysBefore(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

/**
 * The same day of the month, `months` earlier in UTC, clamped to the end of a
 * shorter month: Date's own overflow would turn 31 August minus six months
 * into 3 March and delete a row days early or late.
 */
export function monthsBefore(now: Date, months: number): Date {
  const shifted = new Date(now.getTime());
  shifted.setUTCDate(1);
  shifted.setUTCMonth(shifted.getUTCMonth() - months);
  const lastDay = new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 0),
  ).getUTCDate();
  shifted.setUTCDate(Math.min(now.getUTCDate(), lastDay));
  return shifted;
}

/** Cutoff for access requests, household invites and group invites. */
export function expiredCutoff(now: Date): string {
  return daysBefore(now, EXPIRED_RETENTION_DAYS).toISOString();
}

export function feedbackCutoff(now: Date): string {
  return monthsBefore(now, FEEDBACK_RETENTION_MONTHS).toISOString();
}

/**
 * The cutoff for one church's prayer requests, or null when it has not turned
 * the setting on. Anything but an offered period throws: deleting on a value
 * no church admin could have chosen is not recoverable.
 */
export function prayerCutoff(months: unknown, now: Date): string | null {
  if (months === null) return null;
  if (!PRAYER_RETENTION_MONTHS.some((offered) => offered === months)) {
    throw new Error(`unknown prayer request period: ${String(months)}`);
  }
  return monthsBefore(now, months as number).toISOString();
}

/**
 * Whether a setup link still works. verify-token accepts a token with no
 * expiry, so a null expiry counts as live here too.
 */
export function isLiveSignupToken(tokenExpiresAt: string | null, now: Date): boolean {
  return tokenExpiresAt === null || new Date(tokenExpiresAt).getTime() >= now.getTime();
}
