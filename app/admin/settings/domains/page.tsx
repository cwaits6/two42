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
import {
  TXT_LABEL,
  VERCEL_APEX_A_RECORD,
  VERCEL_CNAME_TARGET,
} from "@/lib/domains";
import type { Tables } from "@/lib/supabase/database.types";

type DomainRow = Tables<"org_domains">;

/**
 * Custom domains for the org: claim a name, publish its DNS records, verify
 * ownership, remove. The same shell as app/admin/settings/email/page.tsx,
 * generalised from one row to a list — an org may hold several claims.
 *
 * The page reads the list on the browser client (a plain RLS-scoped SELECT)
 * and mutates only through the route handlers: claim (request client,
 * insert `domain` only), verify (service-role DNS check) and remove
 * (delete, or the 'removing' hand-off to the attachment worker).
 */

export function statusVariant(
  status: DomainRow["status"],
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "verified":
      return "default";
    case "pending":
      return "secondary";
    case "removing":
      return "outline";
    default:
      return "destructive";
  }
}

export function statusLabel(row: Pick<DomainRow, "status" | "attached_at">): string {
  if (row.status === "verified") {
    return row.attached_at ? "Live" : "Verified, awaiting activation";
  }
  if (row.status === "removing") return "Removing";
  if (row.status === "failed") return "Check failed";
  return "Pending verification";
}

/**
 * Public suffixes that take two labels, so a registrable name under them
 * has three. A short, deliberate list — not the Public Suffix List — because
 * this only steers which routing record the page suggests; verification and
 * attachment do not depend on it. Extend it when a real tenant hits one.
 */
const TWO_LABEL_PUBLIC_SUFFIXES = new Set([
  "co.uk", "org.uk", "me.uk", "ac.uk", "gov.uk",
  "com.au", "net.au", "org.au",
  "co.nz", "org.nz",
  "co.za", "com.br", "co.jp", "co.in", "com.mx",
]);

/**
 * An apex is a registrable name with no subdomain label in front: two labels
 * (`example.church`), or three when the last two are a known two-label public
 * suffix (`example.co.uk`). DNS forbids a CNAME at an apex, so a wrong answer
 * here would tell the admin to publish a record their provider rejects.
 */
export function looksLikeApex(domain: string): boolean {
  const labels = domain.split(".");
  if (labels.length === 2) return true;
  return labels.length === 3 && TWO_LABEL_PUBLIC_SUFFIXES.has(labels.slice(1).join("."));
}

function formatTimestamp(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

type DomainApiResponse = {
  error?: string;
  data?: DomainRow | null;
  verified?: boolean;
  diagnostic?: string;
  message?: string;
  status?: string;
};

/**
 * Fetch + parse-JSON, shared by the claim/verify/remove handlers. A 2xx
 * whose body fails to parse counts as failure unless the caller opts in —
 * a truncated success response must not toast success over stale state.
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

export default function DomainSettingsPage() {
  const supabase = useMemo(() => createClient(), []);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<DomainRow[]>([]);
  const [domainInput, setDomainInput] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);

  const load = useCallback(async () => {
    // Plain RLS-scoped read on the request client: an admin sees exactly
    // their own org's rows. SELECT is granted on the whole row.
    const { data, error } = await supabase
      .from("org_domains")
      .select("*")
      .order("created_at");
    if (error) {
      // Return early: a transient read failure must not clear an
      // already-displayed list.
      console.error("domains load: failed to load custom domains:", error);
      toast.error("Failed to load custom domains.");
      setLoading(false);
      return;
    }
    setRows(data ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const replaceRow = (fresh: DomainRow) =>
    setRows((prev) => prev.map((r) => (r.id === fresh.id ? fresh : r)));

  const handleClaim = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setClaiming(true);
    try {
      const { ok, data } = await requestJson("/api/admin/domains", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: domainInput }),
      });
      if (!ok) {
        toast.error(data?.error || "Failed to claim domain.");
        return;
      }
      toast.success("Domain claimed. Publish the DNS records below, then verify.");
      setDomainInput("");
      if (data?.data) {
        setRows((prev) => [...prev, data.data as DomainRow]);
      } else {
        await load();
      }
    } catch (err) {
      console.error("domain claim: request failed:", err);
      toast.error("Could not reach the server. Check your connection and try again.");
    } finally {
      setClaiming(false);
    }
  };

  const handleVerify = async (row: DomainRow) => {
    setBusyId(row.id);
    try {
      const { ok, data } = await requestJson(`/api/admin/domains/${row.id}/verify`, {
        method: "POST",
      });
      if (!ok) {
        toast.error(data?.error || "Failed to verify domain.");
        return;
      }
      if (data?.data) replaceRow(data.data);
      else await load();
      if (data?.verified) {
        toast.success("Domain verified. It will go live once the platform attaches it.");
      } else {
        toast.info(data?.diagnostic || "Not verified yet. Check back after DNS propagates.");
      }
    } catch (err) {
      console.error("domain verify: request failed:", err);
      toast.error("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusyId(null);
    }
  };

  const handleRemove = async (row: DomainRow) => {
    const prompt = row.attached_at
      ? "Remove this domain? It will stop serving your site once the platform releases it."
      : "Remove this domain claim?";
    if (!confirm(prompt)) return;
    setBusyId(row.id);
    try {
      const { ok, data } = await requestJson(
        `/api/admin/domains/${row.id}`,
        { method: "DELETE" },
        { allowEmptyBody: true },
      );
      if (!ok) {
        toast.error(data?.error || "Failed to remove domain.");
        return;
      }
      if (data?.status === "removing") {
        toast.success("Domain is being released. It will disappear once the platform has detached it.");
        await load();
      } else {
        toast.success("Domain removed.");
        setRows((prev) => prev.filter((r) => r.id !== row.id));
      }
    } catch (err) {
      console.error("domain remove: request failed:", err);
      toast.error("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <PageContainer size="narrow">
        <p className="text-xl text-muted-foreground">Loading...</p>
      </PageContainer>
    );
  }

  return (
    <PageContainer size="narrow">
      <PageHeader
        title="Custom domains"
        subtitle="Claim a domain, publish its DNS records, then verify it. Once verified, the platform attaches it and your site answers on that address."
        backHref="/admin/settings"
        backLabel="Back to Settings"
      />

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl text-brand-primary">Claim domain</CardTitle>
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
                  placeholder="example.church"
                  autoComplete="off"
                  spellCheck={false}
                  className="text-lg py-6"
                  required
                />
                <p className="text-base text-muted-foreground">
                  The address people will type to reach your site, such as
                  example.church or www.example.church.
                </p>
              </div>
              <Button
                type="submit"
                size="lg"
                className="w-full text-lg py-6 bg-brand-primary hover:bg-brand-primary/90 text-white"
                disabled={claiming || domainInput.trim().length === 0}
              >
                {claiming ? "Claiming..." : "Claim domain"}
              </Button>
            </form>
          </CardContent>
        </Card>

        {rows.length === 0 ? (
          <p className="text-lg text-muted-foreground">No domains claimed yet.</p>
        ) : (
          rows.map((row) => {
            const busy = busyId === row.id;
            const apex = looksLikeApex(row.domain);
            const canVerify = row.status === "pending" || row.status === "failed";
            return (
              <Card key={row.id}>
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center gap-3 text-2xl text-brand-primary">
                    <span className="break-all">{row.domain}</span>
                    <Badge variant={statusVariant(row.status)} className="text-base">
                      {statusLabel(row)}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <dl className="grid grid-cols-1 gap-2 text-lg sm:grid-cols-3">
                    <div>
                      <dt className="text-muted-foreground">Verified</dt>
                      <dd>{formatTimestamp(row.verified_at)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Live since</dt>
                      <dd>{formatTimestamp(row.attached_at)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Last checked</dt>
                      <dd>{formatTimestamp(row.last_checked_at)}</dd>
                    </div>
                  </dl>

                  {row.status === "removing" ? (
                    <p className="text-lg text-muted-foreground">
                      This domain is being released. It will disappear from this
                      list once the platform has detached it.
                    </p>
                  ) : (
                    <section className="space-y-3">
                      <h2 className="text-xl font-semibold">DNS records to publish</h2>
                      <ul className="space-y-3">
                        <li className="rounded-md border border-border p-4 text-base">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold">Ownership check</span>
                            <Badge variant="outline">TXT</Badge>
                          </div>
                          <dl className="mt-2 grid grid-cols-1 gap-1">
                            <div>
                              <dt className="text-muted-foreground">Name</dt>
                              <dd className="break-all font-mono">
                                {TXT_LABEL}.{row.domain}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-muted-foreground">Value</dt>
                              <dd className="break-all font-mono">{row.verification_token}</dd>
                            </div>
                          </dl>
                        </li>
                        <li className="rounded-md border border-border p-4 text-base">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold">Routing</span>
                            <Badge variant="outline">{apex ? "A" : "CNAME"}</Badge>
                          </div>
                          <dl className="mt-2 grid grid-cols-1 gap-1">
                            <div>
                              <dt className="text-muted-foreground">Name</dt>
                              <dd className="break-all font-mono">{row.domain}</dd>
                            </div>
                            <div>
                              <dt className="text-muted-foreground">Value</dt>
                              <dd className="break-all font-mono">
                                {apex ? VERCEL_APEX_A_RECORD : VERCEL_CNAME_TARGET}
                              </dd>
                            </div>
                          </dl>
                          {apex ? (
                            <p className="mt-3 text-base text-muted-foreground">
                              This is an apex domain (no subdomain in front of
                              it), and DNS does not allow a CNAME at the apex.
                              Publish the A record above. If your DNS provider
                              offers an ALIAS, ANAME or &quot;CNAME
                              flattening&quot; record at the apex, you may
                              point that at {VERCEL_CNAME_TARGET} instead.
                            </p>
                          ) : (
                            <p className="mt-3 text-base text-muted-foreground">
                              A CNAME works for subdomains like this one. An
                              apex domain (example.church with nothing in
                              front) needs an A record to {VERCEL_APEX_A_RECORD}{" "}
                              instead, or an ALIAS/ANAME record if your provider
                              supports one.
                            </p>
                          )}
                        </li>
                      </ul>
                      {row.status === "verified" && !row.attached_at && (
                        <p className="text-base text-muted-foreground">
                          Ownership is verified. The platform attaches verified
                          domains automatically; this page shows &quot;Live&quot;
                          once that has happened.
                        </p>
                      )}
                    </section>
                  )}

                  {row.status !== "removing" && (
                    <div className="flex flex-col gap-3 sm:flex-row">
                      {canVerify && (
                        <Button
                          type="button"
                          size="lg"
                          className="flex-1 text-lg py-6 bg-brand-primary hover:bg-brand-primary/90 text-white"
                          onClick={() => handleVerify(row)}
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
                        onClick={() => handleRemove(row)}
                        disabled={busy}
                      >
                        Remove
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </PageContainer>
  );
}
