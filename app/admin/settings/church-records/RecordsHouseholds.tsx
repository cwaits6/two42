"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { LoadingState } from "@/components/states/LoadingState";
import { NETWORK_ERROR } from "@/lib/errorCopy";
import { logError } from "@/lib/log";
import {
  householdSections,
  householdTitle,
  personLine,
  suggestionQuestion,
  type HouseholdSuggestionRow,
  type HouseholdsData,
} from "./householdLists";
import { batches, count, page } from "./linkLists";
import { Pager } from "./PersonLinks";
import { call, errorText } from "./requests";

async function postConfirm(ids: readonly string[]) {
  return call("/api/admin/church-records/households", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ suggestions: ids }),
  });
}

const households = (n: number) => (n === 1 ? "1 household" : `${count(n)} households`);

function SuggestionCard({ s, children }: { s: HouseholdSuggestionRow; children?: React.ReactNode }) {
  return (
    <li className="space-y-3 py-4">
      <p className="text-lg font-semibold">{suggestionQuestion(s)}</p>
      {s.people.length > 0 && (
        <ul className="space-y-1">
          {s.people.map((p) => (
            <li key={p.profileId} className="text-base">
              <span className="font-medium">{p.name}</span>
              <span className="text-muted-foreground"> · {personLine(p)}</span>
            </li>
          ))}
        </ul>
      )}
      {children}
    </li>
  );
}

export function RecordsHouseholds({ label }: { label: string }) {
  const [data, setData] = useState<HouseholdsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [pages, setPages] = useState({ ready: 0, checkFirst: 0 });
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [reviewing, setReviewing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [checking, setChecking] = useState<HouseholdSuggestionRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [savingSwitch, setSavingSwitch] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [batchError, setBatchError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await call("/api/admin/church-records/households");
      if (!res.ok) {
        setError(errorText("load the household suggestions", res.status, res.data));
        return;
      }
      const loaded = res.data as unknown as HouseholdsData;
      setData(loaded);
      // A reload after a stopped batch must not re-select what the admin excluded.
      const ids = new Set(loaded.suggestions.map((s) => s.id));
      setExcluded((prev) => new Set([...prev].filter((id) => ids.has(id))));
    } catch (err) {
      logError("Church records households load failed", err, { route: "/admin/settings/church-records" });
      setError(NETWORK_ERROR);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const found = useMemo(() => (data ? householdSections(data, query) : null), [data, query]);

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
  if (!data || !found) return <LoadingState thing="the household suggestions" />;

  async function saveChildren(on: boolean) {
    setSavingSwitch(true);
    try {
      const res = await call("/api/admin/church-records/households", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suggestChildren: on }),
      });
      if (!res.ok) {
        toast.error(errorText("save whether to suggest children", res.status, res.data));
        return;
      }
      setData((prev) => prev && { ...prev, suggestChildren: on });
      toast.success(on ? "Children are suggested from the next refresh." : "Children are no longer suggested.");
    } catch (err) {
      logError("Church records children setting request failed", err, { route: "/admin/settings/church-records" });
      toast.error(NETWORK_ERROR);
    } finally {
      setSavingSwitch(false);
    }
  }

  async function confirmMany(rows: readonly HouseholdSuggestionRow[]) {
    setBusy(true);
    setBatchError(null);
    setProgress({ done: 0, total: rows.length });
    let confirmed = 0;
    let changed = 0;
    try {
      for (const batch of batches(rows)) {
        const res = await postConfirm(batch.map((r) => r.id));
        confirmed += Number(res.data?.confirmed ?? 0);
        changed += Number(res.data?.changed ?? 0);
        if (!res.ok) {
          setBatchError(
            `Confirmed ${households(confirmed)}, then stopped. ${errorText("confirm these households", res.status, res.data)}`,
          );
          return;
        }
        setProgress({ done: confirmed + changed, total: rows.length });
      }
      const skipped = changed > 0 ? ` ${households(changed)} changed since the last refresh and were left as they are.` : "";
      toast.success(`Confirmed ${households(confirmed)}.${skipped}`);
    } catch (err) {
      logError("Church records bulk household confirm request failed", err, { route: "/admin/settings/church-records" });
      setBatchError(`Confirmed ${households(confirmed)}, then stopped. ${NETWORK_ERROR}`);
    } finally {
      setProgress(null);
      setBusy(false);
      await load();
    }
  }

  async function confirmOne(row: HouseholdSuggestionRow) {
    setBusy(true);
    setBatchError(null);
    try {
      const res = await postConfirm([row.id]);
      if (!res.ok) {
        toast.error(errorText("confirm this household", res.status, res.data));
        return;
      }
      toast.success("Household confirmed.");
      await load();
    } catch (err) {
      logError("Church records household confirm request failed", err, { route: "/admin/settings/church-records" });
      toast.error(NETWORK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  const toConfirm = found.ready.filter((s) => !excluded.has(s.id));
  const ready = page(found.ready, pages.ready);
  const checkFirst = page(found.checkFirst, pages.checkFirst);
  const confirmLabel =
    excluded.size > 0 ? `Confirm ${count(toConfirm.length)} selected` : `Confirm all ${count(toConfirm.length)}`;

  return (
    <div className="space-y-8">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl text-brand-primary-text">Children</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <label htmlFor="records-suggest-children" className="text-lg font-semibold">
              Suggest children
            </label>
            <Switch
              id="records-suggest-children"
              className="shrink-0"
              checked={data.suggestChildren}
              disabled={savingSwitch}
              onCheckedChange={saveChildren}
            />
          </div>
          <p className="text-base text-muted-foreground">
            Suggests the children in a confirmed household&apos;s family to its primary and spouse, who add or dismiss
            each one. Only a child&apos;s name, birthday without the year, grade and photo come over. Turning it off
            removes every suggestion not yet added.
          </p>
        </CardContent>
      </Card>

      {data.householdsUnavailable && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-lg" role="alert">
              The last refresh couldn&apos;t read families from {label}. Give the key&apos;s security role view access
              to Groups, GroupMembers and Locations, then choose Refresh now on the People tab.
            </p>
          </CardContent>
        </Card>
      )}

      <p className="text-lg">
        {label} groups people into families. Confirm a suggestion to put its people in one household here. Nothing
        changes until you confirm, and whoever stays behind keeps their household. A confirmed household gets the
        family&apos;s address and home phone at the next refresh, under what two42 copies.
      </p>

      <div className="relative">
        <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          type="search"
          placeholder="Search by name"
          aria-label="Search households"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPages({ ready: 0, checkFirst: 0 });
          }}
          className="h-13 rounded-xl pl-12 text-base"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-2xl text-brand-primary-text">
            Ready to confirm <span className="font-normal text-muted-foreground">· {count(found.ready.length)}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-base text-muted-foreground">Nobody leaves a household they&apos;re in.</p>
          {found.ready.length === 0 ? (
            <p className="text-lg">No households are ready to confirm{query ? " for this search" : ""}.</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-3">
                <Button size="lg" variant="outline" disabled={busy} onClick={() => setReviewing((r) => !r)} aria-expanded={reviewing}>
                  {reviewing ? "Hide list" : "Review list"}
                </Button>
                <Button size="lg" disabled={busy || toConfirm.length === 0} onClick={() => setConfirming(true)}>
                  {confirmLabel}
                </Button>
              </div>
              {reviewing && (
                <>
                  <ul className="divide-y divide-border">
                    {ready.rows.map((s) => (
                      <SuggestionCard key={s.id} s={s}>
                        <label className="flex items-center gap-3 text-base">
                          <Checkbox
                            checked={!excluded.has(s.id)}
                            onCheckedChange={(on) =>
                              setExcluded((prev) => {
                                const next = new Set(prev);
                                if (on === true) next.delete(s.id);
                                else next.add(s.id);
                                return next;
                              })
                            }
                            disabled={busy}
                          />
                          Include
                        </label>
                      </SuggestionCard>
                    ))}
                  </ul>
                  <Pager
                    label="Ready to confirm"
                    index={ready.index}
                    pageTotal={ready.count}
                    onChange={(index) => setPages((prev) => ({ ...prev, ready: index }))}
                  />
                </>
              )}
            </>
          )}
          {progress && (
            <p className="text-lg" role="status" aria-live="polite">
              Confirmed {count(progress.done)} of {count(progress.total)}…
            </p>
          )}
          {batchError && (
            <p className="text-lg" role="alert">
              {batchError}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-2xl text-brand-primary-text">
            Check first <span className="font-normal text-muted-foreground">· {count(found.checkFirst.length)}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-base text-muted-foreground">
            Someone leaves a household they&apos;re in. Check with them before you confirm.
          </p>
          {found.checkFirst.length === 0 ? (
            <p className="text-lg">Nothing to check{query ? " for this search" : ""}.</p>
          ) : (
            <>
              <ul className="divide-y divide-border">
                {checkFirst.rows.map((s) => (
                  <SuggestionCard key={s.id} s={s}>
                    <Button size="lg" variant="outline" disabled={busy} onClick={() => setChecking(s)}>
                      Confirm household
                    </Button>
                  </SuggestionCard>
                ))}
              </ul>
              <Pager
                label="Check first"
                index={checkFirst.index}
                pageTotal={checkFirst.count}
                onChange={(index) => setPages((prev) => ({ ...prev, checkFirst: index }))}
              />
            </>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={checking !== null}
        onOpenChange={(open) => !open && setChecking(null)}
        title="Confirm this household?"
        description={checking ? `Puts them in ${householdTitle(checking.target)}. Whoever stays behind keeps their household.` : undefined}
        confirmLabel="Confirm household"
        pendingLabel="Confirming…"
        onConfirm={async () => {
          const row = checking;
          setChecking(null);
          if (row) await confirmOne(row);
        }}
      >
        {checking && (
          <ul className="space-y-1">
            {checking.people.map((p) => (
              <li key={p.profileId} className="text-base">
                <span className="font-medium">{p.name}</span>
                <span className="text-muted-foreground"> · {personLine(p)}</span>
              </li>
            ))}
          </ul>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Confirm ${households(toConfirm.length)}?`}
        description="Each person moves into the household suggested for them. Anyone who changed since the last refresh is left as they are."
        confirmLabel={confirmLabel}
        pendingLabel="Confirming…"
        onConfirm={async () => {
          setConfirming(false);
          await confirmMany(toConfirm);
        }}
      />
    </div>
  );
}
