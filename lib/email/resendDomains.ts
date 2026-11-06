import { Resend } from "resend";
import { logError, logWarn, stepOf } from "@/lib/log";

/**
 * Remove a domain from Resend, shared by the org admin's claim/remove route
 * and the platform operator's cleanup retry. Returns whether the provider
 * side is now clean:
 *
 *   - true on a successful remove — or when Resend reports the domain
 *     already gone, since a row stuck waiting on a domain that no longer
 *     exists could never be cleared otherwise;
 *   - false on any other { error } response, or a thrown network-level
 *     failure (the SDK throws on those the same way fetch() does).
 *
 * Never throws: every caller is on a failure or cleanup path and must still
 * return its own response.
 */
export async function removeResendDomain(
  resendDomainId: string,
  log: { orgId: string; context: string },
): Promise<boolean> {
  try {
    const { error } = await new Resend(process.env.RESEND_API_KEY).domains.remove(
      resendDomainId,
    );
    if (!error) return true;
    if (error.name === "not_found") {
      logWarn("email-domain: Resend domain already gone, treating as cleaned up", undefined, {
        step: stepOf(log.context),
        ids: { org: log.orgId, resend_domain: resendDomainId },
      });
      return true;
    }
    logError("email-domain: Resend cleanup failed", error, {
      step: stepOf(log.context),
      ids: { org: log.orgId, resend_domain: resendDomainId },
    });
    return false;
  } catch (err) {
    logError("email-domain: Resend cleanup threw", err, {
      step: stepOf(log.context),
      ids: { org: log.orgId, resend_domain: resendDomainId },
    });
    return false;
  }
}
