// The attachment worker's two jobs, as pure orchestration over the
// DomainLeaseClient and VercelClient interfaces — no SDK, no fetch, no env.
// tests/domain_attach_test.ts drives every branch with fakes.
//
// Contract with the run summary (_shared/orgs.ts): `sent` counts domains
// attached or detached this run; `sendFailures` counts domains that ended
// the run in a failed state; `itemFailures[].item` is the org_domains.id
// (never the domain name — ids, not tenant content, in diagnostics). A row
// skipped because another attempt holds its lease is neither.
//
// attached_at is written by stampAttached() and nowhere else in the system,
// and only after Vercel has confirmed the attachment — never optimistically,
// because orgBaseUrl() starts emitting the custom origin the moment it is set.

import type { DomainLeaseClient } from "./domain-lease.ts";
import type { VercelClient } from "./vercel.ts";
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

export async function attachDomainsForOrg(
  client: DomainLeaseClient,
  vercel: VercelClient,
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
      const token = await client.claimAttachLease(row.id, org.id, leaseWindowMs);
      // Zero rows: a live lease elsewhere, or the row moved on. Stop.
      if (!token) continue;

      const add = await vercel.addDomain(row.domain);
      if (add.kind === "permanent") {
        // 409 / 403 / 402 / ownership challenge: nothing a retry can fix.
        // No stamp. Surfaced in the run summary; the lease is left in place
        // so the next attempt waits for the window rather than looping.
        itemFailures.push({ item: row.id, error: `vercel ${add.reason}: ${add.detail}` });
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
          itemFailures.push({
            item: row.id,
            error: "vercel ownership_challenge: on the project but held behind Vercel's own domain verification",
          });
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
