"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
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
  return value.filter(
    (r): r is DnsRecord => typeof r === "object" && r !== null,
  );
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

export default function EmailDomainSettingsPage() {
  const supabase = useMemo(() => createClient(), []);
  const [loading, setLoading] = useState(true);
  const [row, setRow] = useState<EmailDomainRow | null>(null);
  const [domainInput, setDomainInput] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    // Plain RLS-scoped read on the request client: an admin sees exactly
    // their own org's row (or none). SELECT is granted on the whole row.
    const { data, error } = await supabase
      .from("org_email_domains")
      .select("*")
      .maybeSingle();
    if (error) {
      // Return early: a transient read failure must not clear an
      // already-displayed, already-claimed domain back to "unclaimed".
      console.error("email-domain load: failed to load sending domain:", error);
      toast.error("Failed to load sending domain.");
      setLoading(false);
      return;
    }
    setRow(data ?? null);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const handleClaim = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/admin/email-domain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: domainInput }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast.error(data?.error || "Failed to claim domain.");
        return;
      }
      const data = await res.json().catch(() => null);
      toast.success(
        "Domain claimed. Publish the DNS records below, then verify.",
      );
      setDomainInput("");
      if (data?.data) {
        setRow(data.data as EmailDomainRow);
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
      const res = await fetch("/api/admin/email-domain/verify", {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast.error(data?.error || "Failed to verify domain.");
        return;
      }
      const data = await res.json().catch(() => null);
      const fresh = (data?.data as EmailDomainRow | undefined) ?? null;
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

  const handleRemove = async () => {
    if (
      !confirm("Remove this sending domain? You can claim a new one afterward.")
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/email-domain", { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast.error(data?.error || "Failed to remove domain.");
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
        subtitle="Claim a domain, publish its DNS records, then verify it. Email still sends from the platform address until a later release switches it over."
        backHref="/admin/settings"
        backLabel="Back to Settings"
      />

      {!row ? (
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

            <div className="flex flex-col gap-3 sm:flex-row">
              <Button
                type="button"
                size="lg"
                className="flex-1 text-lg py-6 bg-brand-primary hover:bg-brand-primary/90 text-white"
                onClick={handleVerify}
                disabled={busy}
              >
                {busy ? "Working..." : "Verify"}
              </Button>
              <Button
                type="button"
                size="lg"
                variant="outline"
                className="flex-1 text-lg py-6"
                onClick={handleRemove}
                disabled={busy}
              >
                Remove
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </PageContainer>
  );
}
