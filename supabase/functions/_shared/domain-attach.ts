// The attachment worker's two jobs, as pure orchestration over the
// DomainLeaseClient and VercelClient interfaces — no SDK, no fetch, no env.
// tests/domain_attach_test.ts drives every branch with fakes.
//
// Contract with the run summary (_shared/orgs.ts): `sent` counts domains
// attached or detached this run; `sendFailures` counts domains that ended
// the run in a failed state; `itemFailures[].item` is the org_domains.id
// (never the domain name — ids, not tenant content, in diagnostics; the one
// exception is a Vercel ownership challenge, whose TXT record name contains
// the domain and IS the operator's instruction). A row skipped because
// another attempt holds its lease is neither, and neither is a row parked
// behind an unacknowledged permanent-failure event.
//
// Two outcomes are also written to org_domain_worker_events through the
// DomainEventsClient, because the run summary does not outlive the run: a
// permanent Vercel refusal (so the next run skips the row — "no retry" is
// literal, until /platform acknowledges it) and a completed detach (the
// operator's allowlist to-do, which the tombstone's hard-delete would
// otherwise erase). Those rows carry the domain by design.
//
// attached_at is written by stampAttached() and nowhere else in the system,
// and only after Vercel has confirmed the attachment — never optimistically,
// because orgBaseUrl() starts emitting the custom origin the moment it is set.

import type { DomainLeaseClient } from "./domain-lease.ts";
import type { DomainEventsClient } from "./domain-events.ts";
import type { VercelClient, VercelVerificationRecord } from "./vercel.ts";
import type { ItemFailure, OrgRunCounts } from "./orgs.ts";
import { isPlatformApexOrSubdomain } from "./domain-denylist.ts";
import { isAttachmentEntitled } from "./entitlement.ts";

function counts(sent: number, itemFailures: ItemFailure[]): OrgRunCounts {
  return {
    sent,
    sendFailures: itemFailures.length,
    ...(itemFailures.length ? { itemFailures } : {}),
  };
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The operator's action item for a Vercel ownership challenge: the record(s)
 * to publish and the verify call that follows. Deliberately names the domain
 * — the TXT record name is the instruction.
 */
export function describeVerificationChallenge(
  domain: string,
  records: VercelVerificationRecord[],
): string {
  const publish = records.length
    ? records.map((r) => `publish ${r.type} ${r.domain} = ${r.value}`).join("; ")
    : "Vercel returned no verification records; inspect the domain in the Vercel dashboard";
  return `vercel needs_verification: ${publish}; then POST /v9/projects/{projectId}/domains/${domain}/verify. Retried after the lease window`;
}

export async function attachDomainsForOrg(
  client: DomainLeaseClient,
  vercel: VercelClient,
  events: DomainEventsClient,
  org: { id: string },
  apex: string,
  leaseWindowMs: number,
): Promise<OrgRunCounts> {
  // The billing gate: a refused org is skipped silently, never failed, so
  // its rows stay `verified` (ownership proven) until the entitlement exists.
  if (!isAttachmentEntitled(org)) return { sent: 0, sendFailures: 0 };

  const rows = await client.listVerifiedUnattached(org.id);
  let sent = 0;
  const itemFailures: ItemFailure[] = [];

  for (const row of rows) {
    // The real denylist boundary (the claim route's check is UX only): never
    // let a tenant attach the platform apex or a name inside it, and never
    // take a lease on such a row — it is not going to be attached by anyone.
    if (isPlatformApexOrSubdomain(row.domain, apex)) {
      itemFailures.push({ item: row.id, error: "denylisted: platform apex or subdomain" });
      continue;
    }

    try {
      // A permanent Vercel refusal recorded by an earlier run and not yet
      // acknowledged on /platform: nothing has changed, so nothing is
      // retried — no lease, no Vercel call, not a failure. Keyed on the
      // domain, not the row id, so a name deleted and re-claimed under a
      // fresh id stays parked until the operator clears it.
      if (await events.hasUnacknowledgedPermanentFailure(org.id, row.domain)) continue;

      const token = await client.claimAttachLease(row.id, org.id, leaseWindowMs);
      // Zero rows: a live lease elsewhere, or the row moved on. Stop.
      if (!token) continue;

      const add = await vercel.addDomain(row.domain);
      if (add.kind === "permanent") {
        // 409 / 403 / 402: nothing a retry can fix. No stamp. Recorded
        // durably first — the event is what /platform shows and what makes
        // every later run skip this row until it is acknowledged — then
        // surfaced in the run summary. An insert that throws lands in the
        // per-row catch, so the row is still reported either way.
        const error = `vercel ${add.reason}: ${add.detail}`;
        await events.recordPermanentFailure(org.id, row.domain, error);
        itemFailures.push({ item: row.id, error });
        continue;
      }
      if (add.kind === "needs_verification") {
        // Vercel's cross-account ownership challenge: not routed, so no
        // stamp — but not permanent. Surface the record the operator must
        // publish; the row is retried once the lease window elapses, exactly
        // like an ambiguous result.
        const error = describeVerificationChallenge(row.domain, add.verification);
        console.warn("attach-org-domains: row %s: %s", row.id, error);
        itemFailures.push({ item: row.id, error });
        continue;
      }

      let confirmed = add.kind === "added";
      if (add.kind === "already_exists" || add.kind === "ambiguous") {
        // Idempotent-success and timeout/unknown both reconcile the same way:
        // read the domain back and stamp only from a confirmed state. Never
        // re-POST on an ambiguous result.
        const got = await vercel.getDomain(row.domain);
        if (got.kind === "attached") {
          confirmed = true;
        } else if (got.kind === "pending_verification") {
          // Same challenge, seen on the confirm path; same operator action.
          const error = describeVerificationChallenge(row.domain, got.verification);
          console.warn("attach-org-domains: row %s: %s", row.id, error);
          itemFailures.push({ item: row.id, error });
          continue;
        } else if (got.kind === "not_attached") {
          if (add.kind === "already_exists") {
            // Vercel said it exists, then said it does not — contradictory.
            // Report it; the next run reconciles again.
            itemFailures.push({ item: row.id, error: "vercel reported already-exists but GET found no domain" });
          } else {
            itemFailures.push({ item: row.id, error: `vercel add unresolved (${add.detail}); not attached after reconcile` });
          }
          continue;
        } else {
          itemFailures.push({ item: row.id, error: `vercel reconcile failed: ${got.detail}` });
          continue;
        }
      }
      if (!confirmed) continue;

      const stamped = await client.stampAttached(row.id, org.id, token, row.domain, leaseWindowMs);
      if (stamped) {
        sent++;
        continue;
      }

      // Compensation for a lost stamp: Vercel confirmed the attachment but
      // the fenced UPDATE matched nothing. Re-read the row.
      //   Row gone   → the admin deleted the (then-unattached) row mid-flight;
      //                detach the name so no Vercel state outlives its row.
      //                This is the only place the worker undoes its own work,
      //                and only for an attachment it made in this run.
      //   Row present → lease superseded or expired; the live holder will
      //                reconcile and stamp. Leave it.
      if (!(await client.rowStillExists(row.id, org.id))) {
        const removed = await vercel.removeDomain(row.domain);
        if (removed.kind === "error") {
          itemFailures.push({
            item: row.id,
            error: `row deleted mid-attach and compensating detach failed: ${removed.detail}`,
          });
        } else {
          // Not counted in `sent` (nothing was attached this run) and not a
          // failure — but it's the worker's only self-rollback path, so it
          // gets a breadcrumb even though nothing threw.
          console.log(
            "attach-org-domains: compensating detach for row %s (deleted mid-attach): %s",
            row.id,
            removed.kind,
          );
        }
      }
    } catch (err) {
      itemFailures.push({ item: row.id, error: message(err) });
    }
  }

  return counts(sent, itemFailures);
}

export async function detachDomainsForOrg(
  client: DomainLeaseClient,
  vercel: VercelClient,
  events: DomainEventsClient,
  org: { id: string },
  leaseWindowMs: number,
): Promise<OrgRunCounts> {
  const rows = await client.listRemoving(org.id);
  let sent = 0;
  const itemFailures: ItemFailure[] = [];

  for (const row of rows) {
    try {
      const token = await client.claimDetachLease(row.id, org.id, leaseWindowMs);
      if (!token) continue;

      const del = await vercel.removeDomain(row.domain);
      if (del.kind === "error") {
        // Transient (including Vercel's 409 "project being transferred"):
        // retried next run once the lease expires, surfaced meanwhile.
        itemFailures.push({ item: row.id, error: `vercel detach failed: ${del.detail}` });
        continue;
      }

      // `removed` and `not_found` are both success: the name is not on the
      // project. Cleanup completing IS the delete — only now may the
      // tombstone go, and only with the full fenced predicate.
      const deleted = await client.hardDeleteRemoved(row.id, org.id, token);
      if (deleted) {
        // The row is gone, so this event is the only trace that the name
        // still has a redirect-allowlist entry to remove. Only on the
        // success branch: a zero-row delete keeps the tombstone, and a
        // detached event for a row that is still there would be a lie.
        try {
          await events.recordDetached(org.id, row.domain);
        } catch (eventErr) {
          // The detach itself succeeded — Vercel confirmed removal and the
          // tombstone is gone. Only the durable to-do record failed to write.
          // Log the domain (row.id is meaningless now; the row is deleted) so
          // the allowlist cleanup isn't silently lost, and count it as sent —
          // reporting a row failure here would point the operator at a row
          // that no longer exists.
          console.error(
            "attach-org-domains: detached event insert failed for domain %s (org %s): %s",
            row.domain,
            org.id,
            message(eventErr),
          );
        }
        sent++;
      } else {
        itemFailures.push({ item: row.id, error: "tombstone hard-delete affected zero rows" });
      }
    } catch (err) {
      itemFailures.push({ item: row.id, error: message(err) });
    }
  }

  return counts(sent, itemFailures);
}
