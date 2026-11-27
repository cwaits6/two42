"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import { LoadingState } from "@/components/states/LoadingState";
import { NETWORK_ERROR } from "@/lib/errorCopy";
import { FIELD_LABELS } from "@/lib/integrations/records/labels";
import { logError } from "@/lib/log";
import {
  choicesFor,
  type FieldChoice,
  type RefreshCounts,
  refreshMessage,
  SETTINGS_FIELDS,
  type SettingsField,
  settingsBody,
} from "./copyFields";
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
  fields: Partial<Record<SettingsField, "locked" | "member">>;
  lastRefreshedAt: string | null;
  pending: number;
  review: ReviewRow[];
}

type Choices = Partial<Record<SettingsField, FieldChoice>>;

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

  const latest = useRef(0);
  // Kept until a load lands, so Try again after a failed reset still resets.
  const resetPending = useRef(false);

  // A refresh or unlink reloads too, and must not drop choices not yet saved.
  const load = useCallback(async (resetChoices: boolean) => {
    const seq = ++latest.current;
    resetPending.current ||= resetChoices;
    setError(null);
    try {
      const res = await call("/api/admin/church-records/copy");
      if (seq !== latest.current) return;
      if (!res.ok) {
        setError(errorText("load what two42 copies", res.status, res.data));
        return;
      }
      const loaded = res.data as unknown as CopyData;
      setData(loaded);
      if (resetPending.current) setChoices(loaded.fields);
      resetPending.current = false;
    } catch (err) {
      if (seq !== latest.current) return;
      logError("Church records copy settings load failed", err, { route: "/admin/settings/church-records" });
      setError(NETWORK_ERROR);
    }
  }, []);

  useEffect(() => {
    load(true);
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
      await load(true);
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
      const counted = (key: keyof RefreshCounts) => Number(res.data?.[key] ?? 0);
      const message = refreshMessage({
        copied: counted("copied"),
        householdsCopied: counted("householdsCopied"),
        pending: counted("pending"),
        failed: counted("failed"),
        photosSkipped: counted("photosSkipped"),
        householdsUnavailable: res.data?.householdsUnavailable === true,
        stoppedAtBudget: res.data?.stoppedAtBudget === true,
      });
      if (message.tone === "success") toast.success(message.text);
      else toast.warning(message.text);
      await load(false);
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
      await load(false);
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
          <Button size="lg" variant="outline" onClick={() => load(false)}>
            Try again
          </Button>
        </CardContent>
      </Card>
    );
  }
  if (!data) return <LoadingState thing="what two42 copies" />;

  const changed = SETTINGS_FIELDS.some((field) => (choices[field] ?? "off") !== (data.fields[field] ?? "off"));
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
          <fieldset disabled={saving} className="m-0 min-w-0 border-0 p-0">
            <ul className="divide-y divide-border">
              {SETTINGS_FIELDS.map((field) => (
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
                  {field === "address" && (
                    <p className="text-base text-muted-foreground">
                      The family&apos;s address and home phone go to its household, once you confirm the household on
                      the Households tab. Either adult in the household can change or clear them.
                    </p>
                  )}
                  {field === "name" && (
                    <p className="text-base text-muted-foreground">
                      First and last name. The preferred name is filled from the nick name only while a member
                      hasn&apos;t set their own, and members can always change it.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </fieldset>
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
            refreshes every night, reading people changed in {label} since the last refresh and anyone not copied
            yet, such as everyone after a change to what two42 copies.
          </p>
          {data.pending > 0 && (
            <p className="text-lg">{people(data.pending)} still to copy on the next refresh.</p>
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
