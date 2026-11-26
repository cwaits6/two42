"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { LoadingState } from "@/components/states/LoadingState";
import { NETWORK_ERROR } from "@/lib/errorCopy";
import { logError } from "@/lib/log";
import {
  batches,
  count,
  matchedText,
  page,
  people,
  search,
  sections,
  type CheckFirstRow,
  type LinkedRow,
  type LinksData,
  type SuggestionRow,
} from "./linkLists";
import { call, errorText } from "./requests";

type Pages = { ready: number; checkFirst: number; noMatch: number; linked: number };
const FIRST_PAGES: Pages = { ready: 0, checkFirst: 0, noMatch: 0, linked: 0 };

async function postLinks(rows: readonly SuggestionRow[]) {
  return call("/api/admin/church-records/links", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ links: rows.map((r) => ({ profileId: r.profileId, personId: r.personId })) }),
  });
}

function SectionTitle({ children, total }: { children: ReactNode; total: number }) {
  return (
    <CardTitle className="text-2xl text-brand-primary-text">
      {children} <span className="font-normal text-muted-foreground">· {count(total)}</span>
    </CardTitle>
  );
}

export function Pager({ index, pageTotal, onChange, label }: { index: number; pageTotal: number; onChange: (i: number) => void; label: string }) {
  if (pageTotal <= 1) return null;
  return (
    <nav aria-label={`${label} pages`} className="flex items-center justify-between gap-4 pt-4">
      <Button size="lg" variant="outline" disabled={index === 0} onClick={() => onChange(index - 1)}>
        Previous
      </Button>
      <span className="text-base text-muted-foreground">
        Page {index + 1} of {pageTotal}
      </span>
      <Button size="lg" variant="outline" disabled={index >= pageTotal - 1} onClick={() => onChange(index + 1)}>
        Next
      </Button>
    </nav>
  );
}

export function OpenLink({ href, label }: { href: string; label: string }) {
  return (
    <a className="inline-block py-2 text-base text-brand-primary-text underline" href={href} target="_blank" rel="noreferrer">
      Open in {label}
    </a>
  );
}

export function PersonLinks({ label }: { label: string }) {
  const [data, setData] = useState<LinksData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [pages, setPages] = useState<Pages>(FIRST_PAGES);
  const [reviewing, setReviewing] = useState(false);
  const [showNoMatch, setShowNoMatch] = useState(false);
  const [choosing, setChoosing] = useState<string | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [batchError, setBatchError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await call("/api/admin/church-records/links");
      if (!res.ok) {
        setError(errorText("load people", res.status, res.data));
        return;
      }
      setData(res.data as unknown as LinksData);
      setExcluded(new Set());
      setChoosing(null);
    } catch (err) {
      logError("Church records links load failed", err, { route: "/admin/settings/church-records" });
      setError(NETWORK_ERROR);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const all = useMemo(() => (data ? sections(data) : null), [data]);
  const found = useMemo(
    () =>
      all && data
        ? {
            ready: search(all.ready, query),
            checkFirst: search(all.checkFirst, query),
            noMatch: search(all.noMatch, query),
            linked: search(data.linked, query),
          }
        : null,
    [all, data, query],
  );

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
  if (!data || !found) return <LoadingState thing={`people from ${label}`} />;

  const toLink = found.ready.filter((s) => !excluded.has(s.profileId));
  const setPage = (key: keyof Pages) => (index: number) => setPages((prev) => ({ ...prev, [key]: index }));

  async function linkMany(rows: SuggestionRow[]) {
    setBusy(true);
    setBatchError(null);
    setProgress({ done: 0, total: rows.length });
    let done = 0;
    try {
      for (const batch of batches(rows)) {
        const res = await postLinks(batch);
        if (!res.ok) {
          setBatchError(
            `Linked ${count(done)} of ${count(rows.length)}, then stopped. ${errorText("link these people", res.status, res.data)}`,
          );
          return;
        }
        done += batch.length;
        setProgress({ done, total: rows.length });
      }
      toast.success(`Linked ${people(done)}.`);
    } catch (err) {
      logError("Church records bulk link request failed", err, { route: "/admin/settings/church-records" });
      setBatchError(`Linked ${count(done)} of ${count(rows.length)}, then stopped. ${NETWORK_ERROR}`);
    } finally {
      setProgress(null);
      setBusy(false);
      await load();
    }
  }

  async function linkOne(row: SuggestionRow) {
    setBusy(true);
    setBatchError(null);
    try {
      const res = await postLinks([row]);
      if (!res.ok) {
        toast.error(errorText("link this person", res.status, res.data));
        return;
      }
      toast.success(`Linked ${row.name}.`);
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

  const ready = page(found.ready, pages.ready);
  const checkFirst = page(found.checkFirst, pages.checkFirst);
  const noMatch = page(found.noMatch, pages.noMatch);
  const linked = page(found.linked, pages.linked);
  const linkLabel = excluded.size > 0 ? `Link ${count(toLink.length)} selected` : `Link all ${count(toLink.length)}`;

  return (
    <>
      <div className="relative">
        <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          type="search"
          placeholder="Search by name"
          aria-label="Search people"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPages(FIRST_PAGES);
          }}
          className="h-13 rounded-xl pl-12 text-base"
        />
      </div>

      <Card>
        <CardHeader>
          <SectionTitle total={found.ready.length}>Ready to link</SectionTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-base text-muted-foreground">
            The name and an email or birthday agree, and there&apos;s only one possible match on each side.
          </p>
          {found.ready.length === 0 ? (
            <p className="text-lg">No one is ready to link{query ? " for this search" : ""}.</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-3">
                <Button size="lg" variant="outline" disabled={busy} onClick={() => setReviewing((r) => !r)} aria-expanded={reviewing}>
                  {reviewing ? "Hide list" : "Review list"}
                </Button>
                <Button size="lg" disabled={busy || toLink.length === 0} onClick={() => setConfirming(true)}>
                  {linkLabel}
                </Button>
              </div>
              {reviewing && (
                <>
                  <ul className="divide-y divide-border">
                    {ready.rows.map((s) => (
                      <li key={s.profileId} className="flex items-center gap-4 py-4">
                        <Checkbox
                          checked={!excluded.has(s.profileId)}
                          onCheckedChange={(on) =>
                            setExcluded((prev) => {
                              const next = new Set(prev);
                              if (on === true) next.delete(s.profileId);
                              else next.add(s.profileId);
                              return next;
                            })
                          }
                          aria-label={`Link ${s.name}`}
                          disabled={busy}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-lg font-semibold">{s.name}</p>
                          <p className="text-base text-muted-foreground">
                            {label}: {s.personName} · {matchedText(s.matched)}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                  <Pager label="Ready to link" index={ready.index} pageTotal={ready.count} onChange={setPage("ready")} />
                </>
              )}
            </>
          )}
          {progress && (
            <p className="text-lg" role="status" aria-live="polite">
              Linked {count(progress.done)} of {count(progress.total)}…
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
          <SectionTitle total={found.checkFirst.length}>Check first</SectionTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-base text-muted-foreground">
            Only the name agrees, or there&apos;s more than one possible match. Open the record in {label} before you link.
          </p>
          {found.checkFirst.length === 0 ? (
            <p className="text-lg">Nothing to check{query ? " for this search" : ""}.</p>
          ) : (
            <>
              <ul className="divide-y divide-border">
                {checkFirst.rows.map((row) => (
                  <CheckFirstItem
                    key={row.profileId}
                    row={row}
                    label={label}
                    busy={busy}
                    open={choosing === row.profileId}
                    onToggle={() => setChoosing((c) => (c === row.profileId ? null : row.profileId))}
                    onLink={linkOne}
                  />
                ))}
              </ul>
              <Pager label="Check first" index={checkFirst.index} pageTotal={checkFirst.count} onChange={setPage("checkFirst")} />
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <SectionTitle total={found.noMatch.length}>No match found</SectionTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-base text-muted-foreground">Usually not in {label} yet, or spelled differently.</p>
          {found.noMatch.length > 0 && (
            <Button size="lg" variant="outline" onClick={() => setShowNoMatch((s) => !s)} aria-expanded={showNoMatch}>
              {showNoMatch ? "Hide" : "Show"}
            </Button>
          )}
          {showNoMatch && found.noMatch.length > 0 && (
            <>
              <ul className="divide-y divide-border">
                {noMatch.rows.map((row) => (
                  <li key={row.profileId} className="py-3 text-lg">
                    {row.name}
                  </li>
                ))}
              </ul>
              <Pager label="No match found" index={noMatch.index} pageTotal={noMatch.count} onChange={setPage("noMatch")} />
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <SectionTitle total={found.linked.length}>Linked</SectionTitle>
        </CardHeader>
        <CardContent>
          {found.linked.length === 0 ? (
            <p className="text-lg">{query ? "No one linked matches this search." : "No one is linked yet."}</p>
          ) : (
            <>
              <ul className="divide-y divide-border">
                {linked.rows.map((row) => (
                  <li key={row.profileId} className="flex flex-wrap items-center gap-4 py-4">
                    <div className="min-w-0 flex-1">
                      <p className="text-lg font-semibold">{row.name}</p>
                      <OpenLink href={row.personUrl} label={label} />
                    </div>
                    <Button size="lg" variant="outline" disabled={busy} onClick={() => unlink(row)}>
                      Unlink
                    </Button>
                  </li>
                ))}
              </ul>
              <Pager label="Linked" index={linked.index} pageTotal={linked.count} onChange={setPage("linked")} />
            </>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Link ${people(toLink.length)}?`}
        description={`Each person here is linked to the one ${label} record their name and an email or birthday agree with. You can unlink anyone later.`}
        confirmLabel={`Link ${people(toLink.length)}`}
        confirmVariant="default"
        onConfirm={async () => {
          void linkMany(toLink);
        }}
      />
    </>
  );
}

function CheckFirstItem({
  row,
  label,
  busy,
  open,
  onToggle,
  onLink,
}: {
  row: CheckFirstRow;
  label: string;
  busy: boolean;
  open: boolean;
  onToggle: () => void;
  onLink: (s: SuggestionRow) => void;
}) {
  if (row.candidates.length === 1) {
    const [s] = row.candidates;
    return (
      <li className="flex flex-wrap items-center gap-4 py-4">
        <div className="min-w-0 flex-1">
          <p className="text-lg font-semibold">{row.name}</p>
          <p className="text-base text-muted-foreground">
            {label}: {s.personName} · {matchedText(s.matched)}
          </p>
          <OpenLink href={s.personUrl} label={label} />
        </div>
        <Button size="lg" variant="outline" disabled={busy} onClick={() => onLink(s)}>
          Link
        </Button>
      </li>
    );
  }
  return (
    <li className="py-4">
      <div className="flex flex-wrap items-center gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-lg font-semibold">{row.name}</p>
          <p className="text-base text-muted-foreground">{row.candidates.length} possible matches</p>
        </div>
        <Button size="lg" variant="outline" disabled={busy} onClick={onToggle} aria-expanded={open}>
          {open ? "Hide" : "Choose…"}
        </Button>
      </div>
      {open && (
        <ul className="mt-3 space-y-3 border-l-4 border-border pl-4">
          {row.candidates.map((s) => (
            <li key={s.personId} className="flex flex-wrap items-center gap-4">
              <div className="min-w-0 flex-1">
                <p className="text-lg">{s.personName}</p>
                <p className="text-base text-muted-foreground">{matchedText(s.matched)}</p>
                <OpenLink href={s.personUrl} label={label} />
              </div>
              <Button size="lg" variant="outline" disabled={busy} onClick={() => onLink(s)} aria-label={`Link ${row.name} to ${s.personName}`}>
                Link
              </Button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
