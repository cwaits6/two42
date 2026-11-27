"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { LoadingState } from "@/components/states/LoadingState";
import { NETWORK_ERROR } from "@/lib/errorCopy";
import { logError } from "@/lib/log";
import type { RecordsIntakeDestination, RecordsIntakeSetup } from "@/lib/integrations/records/types";
import type { IntakeAnswer } from "@/app/api/admin/church-records/intake/route";
import { call, errorText } from "./requests";

const INTAKE = "/api/admin/church-records/intake";

export function RecordsIntake({ label, setup }: { label: string; setup: RecordsIntakeSetup }) {
  const [intake, setIntake] = useState<IntakeAnswer | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await call(INTAKE);
      if (!res.ok) {
        setError(errorText("load sending new people", res.status, res.data));
        return;
      }
      setIntake((res.data?.intake as IntakeAnswer | null) ?? null);
    } catch (err) {
      logError("Church records new people load failed", err, { route: "/admin/settings/church-records" });
      setError(NETWORK_ERROR);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function turnOff() {
    try {
      const res = await call(INTAKE, { method: "DELETE" });
      if (!res.ok) {
        toast.error(errorText("turn off sending new people", res.status, res.data));
        return;
      }
      setConfirming(false);
      setIntake(null);
      toast.success("Sending new people is off.");
    } catch (err) {
      logError("Church records new people turn off failed", err, { route: "/admin/settings/church-records" });
      toast.error(NETWORK_ERROR);
    }
  }

  if (error) {
    return (
      <Card>
        <CardContent className="space-y-4 pt-6">
          <p className="text-lg" role="alert">
            {error}
          </p>
          <Button size="lg" variant="outline" onClick={() => void load()}>
            Try again
          </Button>
        </CardContent>
      </Card>
    );
  }
  if (intake === undefined) return <LoadingState thing="sending new people" />;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl text-brand-primary-text">Send new people to {label}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-lg">
          When someone joins two42 and ticks Share my details with your church&apos;s office, two42 sends their name,
          email and phone to {label} once, for your staff to review. It never changes anyone already in {label}, and
          never sends someone who is linked.
        </p>
        {editing ? (
          <IntakeForm
            label={label}
            setup={setup}
            current={intake}
            onCancel={() => setEditing(false)}
            onSaved={(saved) => {
              setEditing(false);
              if (saved) setIntake(saved);
              else void load();
            }}
          />
        ) : intake ? (
          <>
            <dl className="grid grid-cols-1 gap-3 text-lg sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">New people go to the {setup.destinationLabel}</dt>
                <dd className="break-words">
                  {intake.destination.name} (id {intake.destination.id})
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{setup.keyLabel}</dt>
                <dd>Ends in {intake.keyHint}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Sent</dt>
                <dd>{intake.sent.toLocaleString("en-US")}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Couldn&apos;t send</dt>
                <dd>{intake.failed.toLocaleString("en-US")}</dd>
              </div>
            </dl>
            {intake.failed > 0 && (
              <p className="text-lg">
                two42 doesn&apos;t send these people again. Add them in {label} yourself.
              </p>
            )}
            {intake.lastFailure && (
              <p className="rounded-lg border border-destructive/40 p-4 text-lg" role="alert">
                {intake.lastFailure}
              </p>
            )}
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button size="lg" variant="outline" className="py-6 text-lg" onClick={() => setEditing(true)}>
                Change
              </Button>
              <Button size="lg" variant="destructive" className="py-6 text-lg" onClick={() => setConfirming(true)}>
                Turn off
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-lg">Off. Turning it on needs a second key from {label}, used only for sending new people.</p>
            <Button size="lg" className="py-6 text-lg" onClick={() => setEditing(true)}>
              Turn on
            </Button>
          </>
        )}
      </CardContent>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Turn off sending new people?"
        description={`two42 removes the write key and sends nobody else. People already sent stay in ${label}.`}
        confirmLabel="Turn off"
        pendingLabel="Turning off…"
        onConfirm={turnOff}
      />
    </Card>
  );
}

function IntakeForm({
  label,
  setup,
  current,
  onCancel,
  onSaved,
}: {
  label: string;
  setup: RecordsIntakeSetup;
  current: IntakeAnswer | null;
  onCancel: () => void;
  /** null when it saved but the answer didn't include the setting, so the card reloads it. */
  onSaved: (saved: IntakeAnswer | null) => void;
}) {
  const [key, setKey] = useState("");
  const [destinationId, setDestinationId] = useState(current?.destination.id ?? "");
  const [destinations, setDestinations] = useState<RecordsIntakeDestination[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [finding, setFinding] = useState(false);
  const items = (destinations ?? []).map((d) => ({ value: d.id, label: d.name }));

  async function find() {
    setFinding(true);
    try {
      const res = await call(`${INTAKE}/destinations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      if (!res.ok) {
        toast.error(errorText(`find ${setup.destinationLabel}s`, res.status, res.data));
        return;
      }
      setDestinations((res.data?.destinations as RecordsIntakeDestination[]) ?? []);
    } catch (err) {
      logError("Church records new people destinations failed", err, { route: "/admin/settings/church-records" });
      toast.error(NETWORK_ERROR);
    } finally {
      setFinding(false);
    }
  }

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await call(INTAKE, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, destinationId }),
      });
      if (!res.ok || !(res.data?.intake || res.data?.saved === true)) {
        toast.error(errorText("save sending new people", res.status, res.data));
        return;
      }
      toast.success(`Saved. New people who share their details go to ${label}.`);
      onSaved((res.data.intake as IntakeAnswer | undefined) ?? null);
    } catch (err) {
      logError("Church records new people save failed", err, { route: "/admin/settings/church-records" });
      toast.error(NETWORK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  const needsKey = !current;
  return (
    <form onSubmit={save} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="intake-key" className="text-lg">
          {setup.keyLabel}
        </Label>
        {current && <p className="text-base text-muted-foreground">Leave it empty to keep the saved key.</p>}
        <Input
          id="intake-key"
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          className="py-6 text-lg"
          required={needsKey}
        />
        <p className="text-base text-muted-foreground">{setup.keyHelp}</p>
      </div>
      <div className="space-y-3">
        <p className="text-lg font-medium">Where new people go</p>
        <p className="text-base text-muted-foreground">{setup.destinationHelp}</p>
        <Button
          type="button"
          size="lg"
          variant="outline"
          className="py-6 text-lg"
          onClick={find}
          disabled={busy || finding || (needsKey && !key.trim())}
        >
          {finding ? "Finding…" : `Find ${setup.destinationLabel}s`}
        </Button>
        {destinations !== null &&
          (destinations.length === 0 ? (
            <p className="text-base">
              {label} has no active {setup.destinationLabel}s the write key can see. Enter its id below instead.
            </p>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="intake-destination" className="text-lg">
                Choose a {setup.destinationLabel}
              </Label>
              <Select items={items} value={destinationId} onValueChange={(v) => setDestinationId(v ?? "")}>
                <SelectTrigger id="intake-destination" className="h-12 w-full text-base">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {items.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        <div className="space-y-2">
          <Label htmlFor="intake-destination-id" className="text-lg">
            Or enter its id
          </Label>
          <Input
            id="intake-destination-id"
            inputMode="numeric"
            value={destinationId}
            onChange={(e) => setDestinationId(e.target.value.trim())}
            autoComplete="off"
            className="py-6 text-lg"
          />
        </div>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button
          type="submit"
          size="lg"
          className="py-6 text-lg"
          disabled={busy || finding || !destinationId || (needsKey && !key.trim())}
        >
          {busy ? "Checking…" : "Save"}
        </Button>
        <Button type="button" size="lg" variant="outline" className="py-6 text-lg" onClick={onCancel} disabled={busy || finding}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
