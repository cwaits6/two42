/**
 * Global backstop cap on total claimed org_email_domains rows across every
 * org. Resend's account tier limits total domains regardless of tenant (10
 * today; the next tier is a paid jump to 1000), so this must stay below that
 * number: a claim is rejected here, with a clear message, before it ever
 * reaches Resend's own limit. Env-overridable so it moves with the Resend
 * plan without a code change.
 *
 * This is a platform-wide count, not a per-org limit — the per-org control
 * is organizations.custom_email_domain_enabled.
 */
export const DEFAULT_ORG_EMAIL_DOMAIN_CAP = 8;

export function getOrgEmailDomainCap(): number {
  const raw = process.env.ORG_EMAIL_DOMAIN_CAP;
  if (!raw) return DEFAULT_ORG_EMAIL_DOMAIN_CAP;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    console.error(
      "ORG_EMAIL_DOMAIN_CAP=%s is not a non-negative integer; using default %d",
      raw,
      DEFAULT_ORG_EMAIL_DOMAIN_CAP,
    );
    return DEFAULT_ORG_EMAIL_DOMAIN_CAP;
  }
  return parsed;
}
