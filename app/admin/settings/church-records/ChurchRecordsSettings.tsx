"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { ErrorState } from "@/components/states/ErrorState";
import { LoadingState } from "@/components/states/LoadingState";
import { failureMessage, NETWORK_ERROR } from "@/lib/errorCopy";
import { logError } from "@/lib/log";


export interface Connection {
  provider: string;
  providerLabel: string;
  baseUrl: string;
  keyHint: string;
  connectedAt: string;
}

export interface SuggestionRow {
  profileId: string;
  name: string;
  personId: string;
  personName: string;
  matched: { email: boolean; birthday: boolean };
  confirmableInBulk: boolean;
}

interface LinkedRow {
  profileId: string;
  name: string;
  personId: string;
  personUrl: string;
  linkedAt: string;
}

interface LinksData {
  linked: LinkedRow[];
  suggestions: SuggestionRow[];
  unmatched: number;
}

// The church records routes answer these statuses with a sentence written for a church admin.
const SPOKEN = new Set([400, 409, 502]);

async function call(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  return { ok: res.ok && data !== null, status: res.status, data };
}

function errorText(action: string, status: number, data: Record<string, unknown> | null): string {
  return SPOKEN.has(status) && typeof data?.error === "string" ? data.error : failureMessage(action, status);
}

/** What agreed besides the name, in words. */
export function matchedText(matched: SuggestionRow["matched"]): string {
  if (matched.email && matched.birthday) return "Name, email and birthday match";
  if (matched.email) return "Name and email match";
  if (matched.birthday) return "Name and birthday match";
  return "Only the name matches";
}

export function ChurchRecordsSettings() {
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [connection, setConnection] = useState<Connection | null>(null);

  const load = useCallback(async () => {
    setLoadFailed(false);
    try {
      const { ok, data } = await call("/api/admin/church-records");
      if (!ok) {
        setLoadFailed(true);
        return;
      }
      setConnection((data?.connection as Connection | null) ?? null);
    } catch (err) {
      logError("Church records settings load failed", err, { route: "/admin/settings/church-records" });
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <PageContainer size="reading">
      <PageHeader
        title="Church records"
        subtitle="Connect the software your church keeps its records in, and link people here to their records. two42 only reads from it."
        backHref="/admin/settings"
        backLabel="Back to Church settings"
      />
      {loading ? (
        <LoadingState thing="the connection" />
      ) : loadFailed ? (
        <ErrorState thing="the connection" onRetry={load} />
      ) : connection ? (
        <div className="space-y-8">
          <ConnectedCard connection={connection} onChange={setConnection} />
          <PersonLinks key={connection.provider + connection.baseUrl + connection.keyHint} label={connection.providerLabel} />
        </div>
      ) : (
        <ConnectForm onConnected={setConnection} />
      )}
    </PageContainer>
  );
}

function ConnectForm({
  onConnected,
  initialAddress = "",
  onCancel,
}: {
  onConnected: (c: Connection) => void;
  initialAddress?: string;
  onCancel?: () => void;
}) {
  const [address, setAddress] = useState(initialAddress);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      const { ok, status, data } = await call("/api/admin/church-records", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "rock", address, key }),
      });
      if (!ok || !data?.connection) {
        toast.error(errorText("connect Rock RMS", status, data));
        return;
      }
      setKey("");
      toast.success("Rock RMS connected.");
      onConnected(data.connection as Connection);
    } catch (err) {
      logError("Church records connect request failed", err, { route: "/admin/settings/church-records" });
      toast.error(NETWORK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl text-brand-primary-text">Connect Rock RMS</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="rock-address" className="text-lg">
              Rock RMS address
            </Label>
            <Input
              id="rock-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="https://rock.yourchurch.org"
              autoComplete="off"
              spellCheck={false}
              className="py-6 text-lg"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="rock-key" className="text-lg">
              REST key
            </Label>
            <Input
              id="rock-key"
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="py-6 text-lg"
              required
            />
            <p className="text-base text-muted-foreground">
              In Rock, add a REST key under Admin Tools, Settings, REST Keys. Give its user a security role of its own
              that can only view the People and DefinedValues REST controllers, with no edit rights. The key isn&apos;t
              shown again after you save it.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button type="submit" size="lg" className="py-6 text-lg" disabled={busy || !address.trim() || !key.trim()}>
              {busy ? "Connecting…" : "Connect Rock RMS"}
            </Button>
            {onCancel && (
              <Button type="button" size="lg" variant="outline" className="py-6 text-lg" onClick={onCancel} disabled={busy}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function ConnectedCard({ connection, onChange }: { connection: Connection; onChange: (c: Connection | null) => void }) {
  const [replacing, setReplacing] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function disconnect() {
    try {
      const { ok, status, data } = await call("/api/admin/church-records", { method: "DELETE" });
      if (!ok) {
        toast.error(errorText(`disconnect ${connection.providerLabel}`, status, data));
        return;
      }
      toast.success(`${connection.providerLabel} disconnected.`);
      setConfirming(false);
      onChange(null);
    } catch (err) {
      logError("Church records disconnect request failed", err, { route: "/admin/settings/church-records" });
      toast.error(NETWORK_ERROR);
    }
  }

  if (replacing) {
    return (
      <ConnectForm
        initialAddress={connection.baseUrl}
        onCancel={() => setReplacing(false)}
        onConnected={(c) => {
          setReplacing(false);
          onChange(c);
        }}
      />
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-3 text-2xl text-brand-primary-text">
          {connection.providerLabel} connected
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <dl className="grid grid-cols-1 gap-3 text-lg sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Address</dt>
            <dd className="break-all">{connection.baseUrl}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Key</dt>
            <dd>Ends in {connection.keyHint}</dd>
          </div>
        </dl>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button size="lg" variant="outline" className="py-6 text-lg" onClick={() => setReplacing(true)}>
            Change key
          </Button>
          <Button size="lg" variant="destructive" className="py-6 text-lg" onClick={() => setConfirming(true)}>
            Disconnect {connection.providerLabel}
          </Button>
        </div>
      </CardContent>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Disconnect ${connection.providerLabel}?`}
        description="This removes the key and every link to a record. Everyone's details in two42 stay as they are."
        confirmLabel={`Disconnect ${connection.providerLabel}`}
        pendingLabel="Disconnecting…"
        onConfirm={disconnect}
      />
    </Card>
  );
}

function PersonLinks({ label }: { label: string }) {
  const [data, setData] = useState<LinksData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await call("/api/admin/church-records/links");
      if (!res.ok) {
        setError(errorText("load people", res.status, res.data));
        return;
      }
      setData(res.data as unknown as LinksData);
      setSelected(new Set());
    } catch (err) {
      logError("Church records links load failed", err, { route: "/admin/settings/church-records" });
      setError(NETWORK_ERROR);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const bulk = useMemo(() => (data?.suggestions ?? []).filter((s) => s.confirmableInBulk), [data]);

  async function confirm(links: SuggestionRow[]) {
    setBusy(true);
    try {
      const res = await call("/api/admin/church-records/links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ links: links.map((l) => ({ profileId: l.profileId, personId: l.personId })) }),
      });
      if (!res.ok) {
        toast.error(errorText("link these people", res.status, res.data));
        return;
      }
      toast.success(links.length === 1 ? "Linked." : `Linked ${links.length} people.`);
      await load();
    } catch (err) {
      logError("Church records link request failed", err, { route: "/admin/settings/church-records" });
      toast.error(NETWORK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  async function unlink(row: LinkedRow) {
    setBusy(true);
    try {
      const res = await call(`/api/admin/church-records/links/${row.profileId}`, { method: "DELETE" });
      if (!res.ok) {
        toast.error(errorText("unlink", res.status, res.data));
        return;
      }
      toast.success(`Unlinked ${row.name}.`);
      await load();
    } catch (err) {
      logError("Church records unlink request failed", err, { route: "/admin/settings/church-records" });
      toast.error(NETWORK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <Card>
        <CardContent className="space-y-4 pt-6">
          <p className="text-lg" role="alert">
            {error}
          </p>
          <Button size="lg" variant="outline" onClick={load}>
            Try again
          </Button>
        </CardContent>
      </Card>
    );
  }
  if (!data) return <LoadingState thing={`people from ${label}`} />;

  const chosen = bulk.filter((s) => selected.has(s.profileId));
  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl text-brand-primary-text">Suggested links</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-base text-muted-foreground">
            A suggestion needs the name to match. An email alone is never enough, because people in one household
            often share an address. Check each one before you link it.
          </p>
          {data.suggestions.length === 0 ? (
            <p className="text-lg">No suggestions right now.</p>
          ) : (
            <>
              <ul className="divide-y divide-border">
                {data.suggestions.map((s) => (
                  <li key={`${s.profileId}-${s.personId}`} className="flex flex-wrap items-center gap-4 py-4">
                    {s.confirmableInBulk ? (
                      <Checkbox
                        checked={selected.has(s.profileId)}
                        onCheckedChange={(on) => toggle(s.profileId, on === true)}
                        aria-label={`Select ${s.name}`}
                        disabled={busy}
                      />
                    ) : (
                      <span className="size-6" aria-hidden="true" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-lg font-semibold">{s.name}</p>
                      <p className="text-base text-muted-foreground">
                        {label}: {s.personName} · {matchedText(s.matched)}
                      </p>
                      {!s.confirmableInBulk && (
                        <Badge variant="secondary" className="mt-1">
                          Check in {label} first
                        </Badge>
                      )}
                    </div>
                    <Button size="lg" variant="outline" disabled={busy} onClick={() => confirm([s])}>
                      Link
                    </Button>
                  </li>
                ))}
              </ul>
              {bulk.length > 0 && (
                <Button size="lg" className="w-full py-6 text-lg sm:w-auto" disabled={busy || chosen.length === 0} onClick={() => confirm(chosen)}>
                  {chosen.length > 0 ? `Link ${chosen.length} selected` : "Link selected"}
                </Button>
              )}
            </>
          )}
          {data.unmatched > 0 && (
            <p className="text-base text-muted-foreground">
              {data.unmatched === 1 ? "1 person has" : `${data.unmatched} people have`} no suggestion. Check their name
              here matches {label}.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-2xl text-brand-primary-text">Linked</CardTitle>
        </CardHeader>
        <CardContent>
          {data.linked.length === 0 ? (
            <p className="text-lg">No one is linked yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {data.linked.map((row) => (
                <li key={row.profileId} className="flex flex-wrap items-center gap-4 py-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-lg font-semibold">{row.name}</p>
                    <a
                      className="text-base text-brand-primary-text underline"
                      href={row.personUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open in {label}
                    </a>
                  </div>
                  <Button size="lg" variant="outline" disabled={busy} onClick={() => unlink(row)}>
                    Unlink
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
