"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { LoadingState } from "@/components/states/LoadingState";
import { NETWORK_ERROR } from "@/lib/errorCopy";
import { logError } from "@/lib/log";
import type { ModeAnswer } from "@/lib/integrations/records/store";
import type { RecordsMode as Mode } from "@/supabase/functions/_shared/records-copy";
import { call, errorText } from "./requests";


/** "This removes 1,240 details copied from your church's records." */
export function removalText(count: number): string {
  return `This removes ${count.toLocaleString("en-US")} ${count === 1 ? "detail" : "details"} copied from your church's records.`;
}

export function RecordsMode({
  label,
  onChange,
  onSaved,
}: {
  label: string;
  onChange: (mode: Mode) => void;
  /** After a switch and its refresh, whose results the copy settings show. */
  onSaved: () => void;
}) {
  const [data, setData] = useState<ModeAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await call("/api/admin/church-records/mode");
      if (!res.ok) {
        setError(errorText("load how two42 uses your church's records", res.status, res.data));
        return;
      }
      const loaded = res.data as unknown as ModeAnswer;
      setData(loaded);
      onChange(loaded.mode);
    } catch (err) {
      logError("Church records mode load failed", err, { route: "/admin/settings/church-records" });
      setError(NETWORK_ERROR);
    }
  }, [onChange]);

  useEffect(() => {
    load();
  }, [load]);

  async function save(mode: Mode) {
    setSaving(true);
    try {
      const res = await call("/api/admin/church-records/mode", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      if (!res.ok) {
        toast.error(errorText("save how two42 uses your church's records", res.status, res.data));
        return;
      }
      setConfirming(false);
      if (mode === "live") {
        toast.success("Saved. Details now come live from your church's records.");
      } else {
        toast.success("Saved. The refresh copies details from your church's records under What two42 copies.");
        // Fills the details in without waiting for the night; a failure here leaves it to the nightly run.
        await call("/api/admin/church-records/refresh", { method: "POST" }).catch(() => null);
      }
      onSaved();
      await load();
    } catch (err) {
      logError("Church records mode save failed", err, { route: "/admin/settings/church-records" });
      toast.error(NETWORK_ERROR);
    } finally {
      setSaving(false);
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
  if (!data) return <LoadingState thing="how two42 uses your church's records" />;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl text-brand-primary-text">How two42 uses your church&apos;s records</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <Segmented
          label="How two42 uses your church's records"
          options={[
            { value: "copy", label: "Copy into two42" },
            { value: "live", label: "Live from your church's records" },
          ]}
          value={data.mode}
          onChange={(mode) => {
            if (saving || mode === data.mode) return;
            if (mode === "live") setConfirming(true);
            else save("copy");
          }}
        />
        <p className="text-lg">
          {data.mode === "copy"
            ? `Details are copied from ${label} into two42 and kept up to date every night.`
            : `The address, birthday, anniversary and child's grade you turn on under What two42 copies are read from ${label} each time someone opens the directory, only for people they can already see, and are never stored in two42.`}
        </p>
        <p className="text-base text-muted-foreground">
          Either way, two42 keeps each linked person&apos;s name, sign-in email, phones, gender and photo. If your church
          needs even names kept out of two42, church records aren&apos;t a fit.
        </p>
      </CardContent>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Show details live?"
        description={`${removalText(data.copiedCount)} Details members changed in two42 stay.`}
        confirmLabel="Remove and switch"
        pendingLabel="Switching…"
        onConfirm={() => save("live")}
      />
    </Card>
  );
}
