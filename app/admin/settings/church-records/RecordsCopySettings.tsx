"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import { LoadingState } from "@/components/states/LoadingState";
import { NETWORK_ERROR } from "@/lib/errorCopy";
import { logError } from "@/lib/log";
import type { RecordsField } from "@/supabase/functions/_shared/records-copy";
import { choicesFor, FIELD_LABELS, type FieldChoice, RECORDS_FIELDS, refreshMessage, settingsBody } from "./copyFields";
import { count, page, people } from "./linkLists";
import { OpenLink, Pager } from "./PersonLinks";
import { call, errorText } from "./requests";

interface ReviewRow {
  profileId: string;
  name: string;
  reason: "inactive" | "missing";
  since: string | null;
  url: string;
}

interface CopyData {
  fields: Partial<Record<RecordsField, "locked" | "member">>;
  lastRefreshedAt: string | null;
  pending: number;
  review: ReviewRow[];
}

type Choices = Partial<Record<RecordsField, FieldChoice>>;

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

export function RecordsCopySettings({ label }: { label: string }) {
  const [data, setData] = useState<CopyData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choices, setChoices] = useState<Choices>({});
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reviewPage, setReviewPage] = useState(0);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await call("/api/admin/church-records/copy");
      if (!res.ok) {
        setError(errorText("load what two42 copies", res.status, res.data));
        return;
      }
      const loaded = res.data as unknown as CopyData;
      setData(loaded);
      setChoices(loaded.fields);
    } catch (err) {
      logError("Church records copy settings load failed", err, { route: "/admin/settings/church-records" });
      setError(NETWORK_ERROR);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    setSaving(true);
    try {
      const res = await call("/api/admin/church-records/copy", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: settingsBody(choices) }),
      });
      if (!res.ok) {
        toast.error(errorText("save what two42 copies", res.status, res.data));
        return;
      }
      toast.success("Saved. The next refresh fills in what you turned on.");
      await load();
    } catch (err) {
      logError("Church records copy settings save failed", err, { route: "/admin/settings/church-records" });
      toast.error(NETWORK_ERROR);
    } finally {
      setSaving(false);
    }
  }

  async function refresh() {
    setRefreshing(true);
    try {
      const res = await call("/api/admin/church-records/refresh", { method: "POST" });
      if (!res.ok) {
        toast.error(errorText("refresh", res.status, res.data));
        return;
      }
      const counted = (key: string) => Number(res.data?.[key] ?? 0);
      const message = refreshMessage({
        copied: counted("copied"),
        pending: counted("pending"),
        failed: counted("failed"),
        photosSkipped: counted("photosSkipped"),
      });
      if (message.tone === "success") toast.success(message.text);
      else toast.warning(message.text);
      await load();
    } catch (err) {
      logError("Church records refresh request failed", err, { route: "/admin/settings/church-records" });
      toast.error(NETWORK_ERROR);
    } finally {
      setRefreshing(false);
    }
  }

  async function unlink(row: ReviewRow) {
    setBusy(true);
    try {
      const res = await call(`/api/admin/church-records/links/${row.profileId}`, { method: "DELETE" });
      if (!res.ok) {
        toast.error(errorText("unlink", res.status, res.data));
        return;
      }
      toast.success(`Unlinked ${row.name}. Their details in two42 stay as they are.`);
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
  if (!data) return <LoadingState thing="what two42 copies" />;

  const changed = RECORDS_FIELDS.some((field) => (choices[field] ?? "off") !== (data.fields[field] ?? "off"));
  const review = page(data.review, reviewPage);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl text-brand-primary-text">What two42 copies</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-lg">
            Choose which details two42 fills in from {label} for linked people. A member who changes or clears a
            detail they can change keeps their own from then on. Only name, suffix, title, gender and a child&apos;s
            grade can be locked.
          </p>
          <ul className="divide-y divide-border">
            {RECORDS_FIELDS.map((field) => (
              <li key={field} className="space-y-3 py-4">
                <p id={`copy-${field}`} className="text-lg font-semibold">
                  {FIELD_LABELS[field]}
                </p>
                <Segmented
                  label={FIELD_LABELS[field]}
                  options={choicesFor(field)}
                  value={choices[field] ?? "off"}
                  onChange={(value) => setChoices((prev) => ({ ...prev, [field]: value }))}
                />
                {field === "name" && (
                  <p className="text-base text-muted-foreground">
                    First and last name. The preferred name is filled from the nick name only while a member
                    hasn&apos;t set their own, and members can always change it.
                  </p>
                )}
              </li>
            ))}
          </ul>
          <p className="text-base text-muted-foreground">
            The sign-in email is never changed. Unlisted phone numbers are never copied.
          </p>
          <Button size="lg" className="py-6 text-lg" disabled={saving || refreshing || !changed} onClick={save}>
            {saving ? "Saving…" : "Save what two42 copies"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-2xl text-brand-primary-text">Refresh</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-lg">
            {data.lastRefreshedAt ? `Last refreshed ${when(data.lastRefreshedAt)}.` : "Not refreshed yet."} two42
            refreshes every night, reading only people changed in {label} since the last refresh.
          </p>
          {data.pending > 0 && (
            <p className="text-lg">{people(data.pending)} still to copy for the first time.</p>
          )}
          <Button size="lg" variant="outline" className="py-6 text-lg" disabled={refreshing || saving} onClick={refresh}>
            {refreshing ? "Refreshing…" : "Refresh now"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-2xl text-brand-primary-text">
            Needs review <span className="font-normal text-muted-foreground">· {count(data.review.length)}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-lg">
            People who became inactive in {label} or can&apos;t be found there. Nothing happens to them
            automatically.
          </p>
          {data.review.length === 0 ? (
            <p className="text-lg">No one needs review.</p>
          ) : (
            <>
              <ul className="divide-y divide-border">
                {review.rows.map((row) => (
                  <li key={row.profileId} className="flex flex-wrap items-center gap-4 py-4">
                    <div className="min-w-0 flex-1">
                      <p className="text-lg font-semibold">{row.name}</p>
                      <p className="text-base text-muted-foreground">
                        {row.reason === "inactive" ? `Inactive in ${label}` : `Not found in ${label}`}
                      </p>
                      {row.reason === "inactive" && <OpenLink href={row.url} label={label} />}
                    </div>
                    <Button size="lg" variant="outline" disabled={busy} onClick={() => unlink(row)}>
                      Unlink
                    </Button>
                  </li>
                ))}
              </ul>
              <Pager label="Needs review" index={review.index} pageTotal={review.count} onChange={setReviewPage} />
            </>
          )}
        </CardContent>
      </Card>
    </>
  );
}
