"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { ErrorState } from "@/components/states/ErrorState";
import { LoadingState } from "@/components/states/LoadingState";
import { NETWORK_ERROR } from "@/lib/errorCopy";
import { logError } from "@/lib/log";
import type { RecordsConnectStep } from "@/lib/integrations/records/types";
import { PersonLinks } from "./PersonLinks";
import { RecordsCopySettings } from "./RecordsCopySettings";
import { call, errorText } from "./requests";

export interface Connection {
  provider: string;
  providerLabel: string;
  /** Whether the provider offers copying people's details into two42. */
  canCopy: boolean;
  baseUrl: string;
  keyHint: string;
  connectedAt: string;
}

/** A provider a church admin can connect, as the connect form shows it. */
export interface ProviderChoice {
  id: string;
  label: string;
  connect: RecordsConnectStep;
}

export function ChurchRecordsSettings({ providers }: { providers: ProviderChoice[] }) {
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [connection, setConnection] = useState<Connection | null>(null);

  const load = useCallback(async () => {
    // Back to loading on a retry, so an existing connection never shows as the connect form meanwhile.
    setLoading(true);
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
        subtitle="Connect the software your church keeps its records in, link people here to their records, and choose what two42 copies from them. two42 only reads from it."
        backHref="/admin/settings"
        backLabel="Back to Church settings"
      />
      {loading ? (
        <LoadingState thing="the connection" />
      ) : loadFailed ? (
        <ErrorState thing="the connection" onRetry={load} />
      ) : connection ? (
        <div className="space-y-8">
          <ConnectedCard connection={connection} providers={providers} onChange={setConnection} />
          <PersonLinks key={connection.provider + connection.baseUrl + connection.keyHint} label={connection.providerLabel} />
          {connection.canCopy && (
            <RecordsCopySettings key={connection.provider + connection.baseUrl} label={connection.providerLabel} />
          )}
        </div>
      ) : (
        <ConnectForm providers={providers} onConnected={setConnection} />
      )}
    </PageContainer>
  );
}

function ConnectForm({
  providers,
  onConnected,
  initialProvider,
  initialAddress = "",
  onCancel,
}: {
  providers: ProviderChoice[];
  onConnected: (c: Connection) => void;
  initialProvider?: string;
  initialAddress?: string;
  onCancel?: () => void;
}) {
  const [providerId, setProviderId] = useState(
    providers.some((p) => p.id === initialProvider) ? initialProvider : providers[0]?.id,
  );
  const [address, setAddress] = useState(initialAddress);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const provider = providers.find((p) => p.id === providerId);
  if (!provider) return null;
  const { connect, label } = provider;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      const { ok, status, data } = await call("/api/admin/church-records", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: providerId, address, key }),
      });
      if (!ok || !data?.connection) {
        toast.error(errorText(`connect ${label}`, status, data));
        return;
      }
      setKey("");
      toast.success(`${label} connected.`);
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
        <CardTitle className="text-2xl text-brand-primary-text">Connect {label}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-6">
          {providers.length > 1 && (
            <div className="space-y-2">
              <p className="text-lg font-medium">Church software</p>
              <Segmented
                label="Church software"
                options={providers.map((p) => ({ value: p.id, label: p.label }))}
                value={provider.id}
                onChange={setProviderId}
              />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor={`${provider.id}-address`} className="text-lg">
              {connect.addressLabel}
            </Label>
            <Input
              id={`${provider.id}-address`}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder={connect.addressPlaceholder}
              autoComplete="off"
              spellCheck={false}
              className="py-6 text-lg"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${provider.id}-key`} className="text-lg">
              {connect.keyLabel}
            </Label>
            <Input
              id={`${provider.id}-key`}
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="py-6 text-lg"
              required
            />
            <p className="text-base text-muted-foreground">{connect.keyHelp}</p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button type="submit" size="lg" className="py-6 text-lg" disabled={busy || !address.trim() || !key.trim()}>
              {busy ? "Connecting…" : `Connect ${label}`}
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

function ConnectedCard({
  connection,
  providers,
  onChange,
}: {
  connection: Connection;
  providers: ProviderChoice[];
  onChange: (c: Connection | null) => void;
}) {
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
        providers={providers}
        initialProvider={connection.provider}
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
        description="This removes the key and every link to a record. Everyone's details in two42 stay as they are, including what was copied, and members can change them."
        confirmLabel={`Disconnect ${connection.providerLabel}`}
        pendingLabel="Disconnecting…"
        onConfirm={disconnect}
      />
    </Card>
  );
}
