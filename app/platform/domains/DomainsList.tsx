"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ATTACH_LEASE_WINDOW_MS } from "@/lib/domains";
import type { Database } from "@/lib/supabase/database.types";

export interface PlatformDomain {
  id: string;
  org_id: string;
  domain: string;
  status: Database["public"]["Enums"]["org_domain_status"];
  verified_at: string | null;
  attached_at: string | null;
  attach_claimed_at: string | null;
  last_checked_at: string | null;
  created_at: string;
  organizations: { name: string; slug: string } | null;
}

interface DomainsListProps {
  initialRows: PlatformDomain[];
}

export type LeaseState =
  | { kind: "none" }
  | { kind: "live"; expiresAt: Date }
  | { kind: "expired"; claimedAt: Date };

/** Where the worker's single-flight lease on a row stands, relative to `now`. */
export function leaseState(attachClaimedAt: string | null, now: number): LeaseState {
  if (!attachClaimedAt) return { kind: "none" };
  const claimedAt = new Date(attachClaimedAt);
  const expiresAt = new Date(claimedAt.getTime() + ATTACH_LEASE_WINDOW_MS);
  return expiresAt.getTime() > now ? { kind: "live", expiresAt } : { kind: "expired", claimedAt };
}

/** Coarse bucket for the list: what the operator needs to do about the row, if anything. */
export function attachmentState(row: Pick<PlatformDomain, "status" | "attached_at">): {
  label: string;
  variant: "default" | "secondary" | "destructive" | "outline";
} {
  if (row.status === "removing") return { label: "Detach pending", variant: "outline" };
  if (row.status === "verified" && row.attached_at) return { label: "Attached", variant: "default" };
  if (row.status === "verified") return { label: "Awaiting attach", variant: "secondary" };
  if (row.status === "failed") return { label: "Check failed", variant: "destructive" };
  return { label: "Unverified", variant: "secondary" };
}

// Locale and time zone are explicit: a bare toLocaleString() renders in the
// server's zone during SSR and the browser's on hydration, which React
// reports as a mismatch.
function formatTime(value: Date | string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });
}

export function DomainsList({ initialRows }: DomainsListProps) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  // Sampled once per mount, not per render: lease state is a function of
  // "now", and a value that moved between renders would flip rows
  // unpredictably. A refresh (router.refresh() after a retry, or a reload)
  // re-samples it.
  const [now] = useState(() => Date.now());

  async function handleRetry(row: PlatformDomain) {
    setBusyId(row.id);
    try {
      const res = await fetch(`/api/platform/domains/${row.id}/retry`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error || "Failed to clear the claim.");
        return;
      }
      if (data?.released) toast.success(data.message);
      else toast.info(data?.message || "Nothing to retry.");
      router.refresh();
    } catch (err) {
      console.error(err);
      toast.error("Network error. Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  const awaiting = initialRows.filter((r) => r.status === "verified" && !r.attached_at);
  const removing = initialRows.filter((r) => r.status === "removing");

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Work queue</h2>
        <p className="text-base text-muted-foreground">
          {awaiting.length} awaiting attach, {removing.length} awaiting detach. A
          permanent Vercel refusal (409, 403, 402) is reported in the worker&apos;s
          run output and function logs; it is not yet recorded on the row.
        </p>
      </section>

      {initialRows.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-base text-muted-foreground">No domains claimed yet.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {initialRows.map((row) => {
            const state = attachmentState(row);
            const lease = leaseState(row.attach_claimed_at, now);
            const showLease = row.status === "removing" || (row.status === "verified" && !row.attached_at);
            const canRetry = row.status === "verified" && !row.attached_at && lease.kind === "expired";
            return (
              <Card key={row.id}>
                <CardContent className="pt-6">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-xl font-semibold break-all">{row.domain}</p>
                        <Badge variant={state.variant}>{state.label}</Badge>
                      </div>
                      <p className="text-base text-muted-foreground">
                        {row.organizations?.name ?? "Unknown organization"}
                        {row.organizations?.slug ? ` (${row.organizations.slug})` : ""}
                      </p>
                      <dl className="mt-2 grid grid-cols-1 gap-1 text-sm text-muted-foreground sm:grid-cols-3">
                        <div>
                          <dt className="inline">Verified: </dt>
                          <dd className="inline">{formatTime(row.verified_at)}</dd>
                        </div>
                        <div>
                          <dt className="inline">Attached: </dt>
                          <dd className="inline">{formatTime(row.attached_at)}</dd>
                        </div>
                        <div>
                          <dt className="inline">Last DNS check: </dt>
                          <dd className="inline">{formatTime(row.last_checked_at)}</dd>
                        </div>
                      </dl>
                      {showLease && (
                        <p className="mt-2 text-sm">
                          {lease.kind === "none" && "Worker claim: not yet claimed."}
                          {lease.kind === "live" && `Worker claim: live, expires ${formatTime(lease.expiresAt)}.`}
                          {lease.kind === "expired" &&
                            `Worker claim: expired (claimed ${formatTime(lease.claimedAt)}) — eligible for retry.`}
                        </p>
                      )}
                      {row.status === "removing" && (
                        <p className="mt-2 text-sm text-muted-foreground">
                          The worker will remove this name from the Vercel project
                          and then delete the row. Remove its redirect-allowlist
                          entry in the Supabase dashboard once it is gone.
                        </p>
                      )}
                    </div>
                    {canRetry && (
                      <div className="flex gap-2 shrink-0">
                        <Button
                          size="lg"
                          variant="outline"
                          className="text-lg"
                          onClick={() => handleRetry(row)}
                          disabled={busyId === row.id}
                        >
                          {busyId === row.id ? "Clearing..." : "Clear expired claim"}
                        </Button>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
