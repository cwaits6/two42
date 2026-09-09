"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import type { Tables } from "@/lib/supabase/database.types";

type EmailDomainRow = Tables<"org_email_domains">;

/**
 * One DNS record as Resend returns it. Rendered defensively — every field
 * is optional so a shape change on Resend's side degrades to a partial row,
 * never a crash.
 */
export interface DnsRecord {
  record?: string;
  name?: string;
  type?: string;
  value?: string;
  ttl?: string;
  priority?: number;
  status?: string;
}

export function toDnsRecords(value: unknown): DnsRecord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): DnsRecord[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const record = entry as Record<string, unknown>;
    return [
      {
        record: typeof record.record === "string" ? record.record : undefined,
        name: typeof record.name === "string" ? record.name : undefined,
        type: typeof record.type === "string" ? record.type : undefined,
        value: typeof record.value === "string" ? record.value : undefined,
        ttl: typeof record.ttl === "string" ? record.ttl : undefined,
        priority:
          typeof record.priority === "number" ? record.priority : undefined,
        status: typeof record.status === "string" ? record.status : undefined,
      },
    ];
  });
}

export function statusVariant(
  status: string,
): "default" | "secondary" | "destructive" {
  if (status === "verified") return "default";
  if (
    status === "pending" ||
    status === "not_started" ||
    status === "partially_verified"
  ) {
    return "secondary";
  }
  return "destructive";
}

export function statusLabel(status: string): string {
  return status.replace(/_/g, " ");
}

function formatTimestamp(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

type DomainApiResponse = {
  error?: string;
  data?: EmailDomainRow | null;
  enabled?: boolean;
};

/**
 * Fetch + parse-JSON, shared by the load/claim/verify/remove handlers below.
 * A 2xx whose body fails to parse counts as failure unless the caller opts
 * in via allowEmptyBody (the DELETE contract carries no envelope worth
 * requiring) — a truncated or non-JSON success response must not toast
 * success over stale state.
 */
async function requestJson(
  url: string,
  init?: RequestInit,
  { allowEmptyBody = false }: { allowEmptyBody?: boolean } = {},
): Promise<{ ok: boolean; data: DomainApiResponse | null }> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => null);
  return { ok: res.ok && (allowEmptyBody || data !== null), data };
}

export default function EmailDomainSettingsPage() {
  const [loading, setLoading] = useState(true);
  // null = not loaded (or the load failed). Fail closed: no claim form until
  // the server has said custom domains are enabled for this org.
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [row, setRow] = useState<EmailDomainRow | null>(null);
  const [domainInput, setDomainInput] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    // One request for both the row and the enablement flag: the flag is a
    // platform-operator column the admin's own client cannot read, so the
    // route reads it server-side and returns it alongside the row.
    try {
      const { ok, data } = await requestJson("/api/admin/email-domain");
      if (!ok || typeof data?.enabled !== "boolean") {
        // Return early: a transient read failure must not clear an
        // already-displayed, already-claimed domain back to "unclaimed".
        console.error(
          "email-domain load: failed to load sending domain:",
          data?.error,
        );
        toast.error("Failed to load sending domain settings.");
        return;
      }
      setEnabled(data.enabled);
      setRow(data.data ?? null);
    } catch (err) {
      console.error("email-domain load: request failed:", err);
      toast.error("Could not reach the server. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleClaim = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { ok, data } = await requestJson("/api/admin/email-domain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: domainInput }),
      });
      if (!ok) {
        toast.error(data?.error || "Failed to claim domain.");
        return;
      }
      toast.success(
        "Domain claimed. Publish the DNS records below, then verify.",
      );
      setDomainInput("");
      if (data?.data) {
        setRow(data.data);
      } else {
        await load();
      }
    } catch (err) {
      console.error("email-domain claim: request failed:", err);
      toast.error("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const handleVerify = async () => {
    setBusy(true);
    try {
      const { ok, data } = await requestJson("/api/admin/email-domain/verify", {
        method: "POST",
      });
      if (!ok) {
        toast.error(data?.error || "Failed to verify domain.");
        return;
      }
      const fresh = data?.data ?? null;
      if (fresh) {
        setRow(fresh);
        if (fresh.status === "verified") {
          toast.success("Domain verified.");
        } else {
          toast.info(
            `Status: ${statusLabel(fresh.status)}. Check back after DNS propagates.`,
          );
        }
      } else {
        await load();
      }
    } catch (err) {
      console.error("email-domain verify: request failed:", err);
      toast.error("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const cleanupPending = row?.status === "cleanup_pending";

  const handleRemove = async () => {
    if (
      !confirm(
        cleanupPending
          ? "Retry removing this sending domain?"
          : "Remove this sending domain? You can claim a new one afterward.",
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const { ok, data } = await requestJson(
        "/api/admin/email-domain",
        { method: "DELETE" },
        { allowEmptyBody: true },
      );
      if (!ok) {
        toast.error(data?.error || "Failed to remove domain.");
        // A failed provider-side removal leaves the row marked as still
        // cleaning up — reload so the card shows that state.
        await load();
        return;
      }
      toast.success("Domain removed.");
      setRow(null);
    } catch (err) {
      console.error("email-domain remove: request failed:", err);
      toast.error("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <PageContainer size="narrow">
        <p className="text-xl text-muted-foreground">Loading...</p>
      </PageContainer>
    );
  }

  const records = row ? toDnsRecords(row.dns_records) : [];

  return (
    <PageContainer size="narrow">
      <PageHeader
        title="Email sending domain"
        subtitle="Claim a domain, publish its DNS records, then verify it. Email sends from the platform address until the domain is verified, then switches to a noreply@ address on your domain."
        backHref="/admin/settings"
        backLabel="Back to Settings"
      />

      {!row && enabled === null ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-lg text-muted-foreground">
              Failed to load your sending domain settings. Refresh to try
              again.
            </p>
          </CardContent>
        </Card>
      ) : !row && !enabled ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl text-brand-primary">
              Custom sending domain
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-lg">
              Custom sending domains aren&apos;t available for your
              organization yet. Contact support to request access.
            </p>
          </CardContent>
        </Card>
      ) : !row ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl text-brand-primary">
              Claim domain
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleClaim} className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="domain" className="text-lg">
                  Domain
                </Label>
                <Input
                  id="domain"
                  value={domainInput}
                  onChange={(e) => setDomainInput(e.target.value)}
                  placeholder="mail.example.church"
                  autoComplete="off"
                  spellCheck={false}
                  className="text-lg py-6"
                  required
                />
                <p className="text-base text-muted-foreground">
                  Use a subdomain such as mail.example.church rather than the
                  bare domain, so these records do not collide with your
                  existing email setup.
                </p>
              </div>
              <Button
                type="submit"
                size="lg"
                className="w-full text-lg py-6 bg-brand-primary hover:bg-brand-primary/90 text-white"
                disabled={busy || domainInput.trim().length === 0}
              >
                {busy ? "Claiming..." : "Claim domain"}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-3 text-2xl text-brand-primary">
              <span className="break-all">{row.domain}</span>
              <Badge
                variant={statusVariant(row.status)}
                className="text-base capitalize"
              >
                {statusLabel(row.status)}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {cleanupPending ? (
              <p className="text-lg" role="status">
                This domain&apos;s removal didn&apos;t finish with the email
                provider
                {row.cleanup_failed_at
                  ? ` (last tried ${formatTimestamp(row.cleanup_failed_at)})`
                  : ""}
                . Click Remove to retry. Email keeps sending from the platform
                address in the meantime.
              </p>
            ) : (
              <dl className="grid grid-cols-1 gap-2 text-lg sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">Verified</dt>
                  <dd>{formatTimestamp(row.verified_at)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Last checked</dt>
                  <dd>{formatTimestamp(row.last_checked_at)}</dd>
                </div>
              </dl>
            )}

            {!cleanupPending && (
              <section className="space-y-3">
                <h2 className="text-xl font-semibold">DNS records to publish</h2>
                {records.length === 0 ? (
                  <p className="text-lg text-muted-foreground">
                    No records returned yet. Try Verify to refresh.
                  </p>
                ) : (
                  <ul className="space-y-3">
                    {records.map((r, i) => (
                      <li
                        key={`${r.record ?? "record"}-${r.name ?? i}`}
                        className="rounded-md border border-border p-4 text-base"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold">
                            {r.record ?? "Record"}
                          </span>
                          {r.type && <Badge variant="outline">{r.type}</Badge>}
                          {r.status && (
                            <Badge
                              variant={statusVariant(r.status)}
                              className="capitalize"
                            >
                              {statusLabel(r.status)}
                            </Badge>
                          )}
                        </div>
                        <dl className="mt-2 grid grid-cols-1 gap-1">
                          <div>
                            <dt className="text-muted-foreground">Name</dt>
                            <dd className="break-all font-mono">
                              {r.name ?? "—"}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-muted-foreground">Value</dt>
                            <dd className="break-all font-mono">
                              {r.value ?? "—"}
                            </dd>
                          </div>
                          {r.priority !== undefined && (
                            <div>
                              <dt className="text-muted-foreground">Priority</dt>
                              <dd className="font-mono">{r.priority}</dd>
                            </div>
                          )}
                          {r.ttl && (
                            <div>
                              <dt className="text-muted-foreground">TTL</dt>
                              <dd className="font-mono">{r.ttl}</dd>
                            </div>
                          )}
                        </dl>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            <div className="flex flex-col gap-3 sm:flex-row">
              {!cleanupPending && (
                <Button
                  type="button"
                  size="lg"
                  className="flex-1 text-lg py-6 bg-brand-primary hover:bg-brand-primary/90 text-white"
                  onClick={handleVerify}
                  disabled={busy}
                >
                  {busy ? "Working..." : "Verify"}
                </Button>
              )}
              <Button
                type="button"
                size="lg"
                variant="outline"
                className="flex-1 text-lg py-6"
                onClick={handleRemove}
                disabled={busy}
              >
                {busy ? "Working..." : cleanupPending ? "Retry removal" : "Remove"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </PageContainer>
  );
}
