"use client";

import { useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Shuffle, TriangleAlert } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { publishedNotice, type EmailOutcome } from "@/lib/dinnerClub/emailOutcome";
import {
  blocksPublish,
  dinnerKey,
  draftWarnings,
  freeSeats,
  moveGuests,
  moveParty,
  partyPeople,
  seatParty,
  setTableHost,
  shuffle,
  swapHostTurns,
  swapParties,
  tableSeats,
  tablesWithRoom,
  type DinnerFormat,
  type Draft,
  type DraftTable,
  type ShuffleParty,
} from "@/lib/dinnerClub/shuffle";
import { failureMessage } from "@/lib/errorCopy";
import { createClient } from "@/lib/supabase/client";
import { HostingDetailsDialog } from "./HostingDetailsDialog";

type Option = { value: string; label: string };

function OptionSelect({
  id,
  label,
  items,
  value,
  placeholder,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  items: Option[];
  value: string | null;
  placeholder?: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-base text-muted-foreground">
        {label}
      </Label>
      <Select items={items} value={value} disabled={disabled} onValueChange={(next) => next && onChange(next)}>
        <SelectTrigger id={id} className="h-12 w-full text-base sm:w-72">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {items.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

type HostPick = { id: string; label: string; partyId: string | null; dateIds: string[] };

/**
 * The host selects a table offers, over its dates still open to a new host.
 * A one-host table shows one select while those dates share a host, and one
 * per date once they differ, as after a stand-in is published; a date whose
 * host can't host has its own stand-in picker and is left out.
 */
function hostPicks(
  t: DraftTable,
  format: DinnerFormat,
  isHeld: (seasonDateId: string) => boolean,
  isCantHost: (seasonDateId: string) => boolean,
  dateLabel: Map<string, string>
): HostPick[] {
  const open = t.hosts.filter((h) => !isHeld(h.seasonDateId));
  const perDate = (hosts: typeof open) =>
    hosts.map((h) => ({
      id: `host-${t.key}-${h.seasonDateId}`,
      label: format === "new_tables" ? "Host" : `Host on ${dateLabel.get(h.seasonDateId) ?? "this date"}`,
      partyId: h.partyId,
      dateIds: [h.seasonDateId],
    }));
  if (format !== "same_table_one_host") return perDate(open);
  const regular = open.filter((h) => !isCantHost(h.seasonDateId));
  const hosts = new Set(regular.flatMap((h) => (h.partyId ? [h.partyId] : [])));
  if (hosts.size > 1) return perDate(regular);
  if (regular.length === 0) return [];
  const partyId = [...hosts][0] ?? null;
  const dateIds = open.filter((h) => h.partyId === partyId || h.partyId === null).map((h) => h.seasonDateId);
  return [{ id: `host-${t.key}`, label: "Host", partyId, dateIds }];
}

export function TablesEditor({
  groupId,
  seasonId,
  format,
  published,
  dates,
  tableSize,
  allowBackToBack,
  parties,
  names,
  initialDraft,
  heldDinners,
  futureDateIds,
  cantHost,
  pastPairs,
}: {
  groupId: string;
  seasonId: string;
  format: DinnerFormat;
  published: boolean;
  dates: Option[];
  tableSize: { min: number; max: number };
  allowBackToBack: boolean;
  parties: ShuffleParty[];
  /** Each party's people, by party id. */
  names: Record<string, string>;
  initialDraft: Draft | null;
  /** Dinners already held, as `dinnerKey(tableId, seasonDateId)`. */
  heldDinners: string[];
  /** Season dates still to come. */
  futureDateIds: string[];
  /** Dinners still to come whose host said they can't host: the published host, by `dinnerKey(tableId, seasonDateId)`. */
  cantHost: Record<string, string>;
  /** Parties who shared a table in the last two seasons. */
  pastPairs: [string, string][];
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(initialDraft);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [confirmShuffle, setConfirmShuffle] = useState(false);
  const dateIds = dates.map((d) => d.value);
  const dateLabel = new Map(dates.map((d) => [d.value, d.label]));
  const byId = useMemo(() => new Map(parties.map((p) => [p.id, p])), [parties]);
  const settings = { format, parties, dateIds, tableSize, allowBackToBack, pastPairs };
  const held = useMemo(() => new Set(heldDinners), [heldDinners]);
  const future = useMemo(() => new Set(futureDateIds), [futureDateIds]);
  const warnings = draft ? draftWarnings(draft, settings, held) : null;
  const blocked = warnings ? blocksPublish(warnings) : false;
  const blockedId = useId();
  const unseated = draft
    ? parties.filter((p) => !draft.tables.some((t) => t.partyIds.includes(p.id)))
    : [];
  // Once published, a party off a table is seated by hand at one with room,
  // which changes no other table: for each date still to come when tables
  // change each dinner, for the season otherwise.
  const waiting: { dateId: string | null; party: ShuffleParty }[] =
    draft && published
      ? format === "new_tables"
        ? dateIds
            .filter((d) => future.has(d))
            .flatMap((d) =>
              parties
                .filter((p) => !draft.tables.some((t) => t.seasonDateId === d && t.partyIds.includes(p.id)))
                .map((party) => ({ dateId: d, party }))
            )
        : unseated.map((party) => ({ dateId: null, party }))
      : [];
  const tableNumber = (t: DraftTable) =>
    (draft?.tables.filter((o) => o.seasonDateId === t.seasonDateId) ?? []).indexOf(t) + 1;

  // One save at a time: publish reads the stored draft, so an earlier save
  // landing after a later one would publish tables the leader no longer sees.
  const inFlight = useRef(false);
  async function save(next: Draft): Promise<boolean> {
    if (inFlight.current) return false;
    inFlight.current = true;
    setDraft(next);
    setSaving(true);
    const { data, error } = await createClient()
      .from("dinner_drafts")
      .upsert({ season_id: seasonId, group_id: groupId, body: JSON.parse(JSON.stringify(next)) }, { onConflict: "season_id" })
      .select("season_id");
    inFlight.current = false;
    setSaving(false);
    if (error || !data?.length) {
      toast.error(failureMessage("save the tables"));
      return false;
    }
    return true;
  }

  async function shuffleAgain() {
    const seed = crypto.getRandomValues(new Uint32Array(1))[0] >>> 1;
    if (await save(shuffle({ ...settings, seed }))) toast.success(draft ? "Shuffled again." : "Tables shuffled.");
  }

  async function publish() {
    // Publish reads the stored draft, and the one on screen may have been
    // fitted to dates and parties that changed since it was saved.
    if (!draft || !(await save(draft))) {
      setPublishing(false);
      return;
    }
    try {
      const res = await fetch(`/api/dinner-club/seasons/${seasonId}/publish`, { method: "POST" });
      const body = (await res.json().catch(() => null)) as ({ error?: string; changed: number } & EmailOutcome) | null;
      setPublishing(false);
      if (!res.ok || !body) {
        toast.error(res.status === 400 ? (body?.error ?? failureMessage("publish the tables")) : failureMessage("publish the tables", res.status));
        return;
      }
      const notice = publishedNotice(body);
      toast[notice.kind](notice.text);
      router.refresh();
    } catch {
      toast.error(failureMessage("publish the tables", "network"));
    }
  }

  const groupsOfTables: { dateId: string | null; tables: DraftTable[] }[] = !draft
    ? []
    : format === "new_tables"
      ? dateIds.map((d) => ({ dateId: d, tables: draft.tables.filter((t) => t.seasonDateId === d) }))
      : [{ dateId: null, tables: draft.tables }];

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <Button size="lg" onClick={() => (draft && published ? setConfirmShuffle(true) : shuffleAgain())} disabled={saving || parties.length === 0}>
          <Shuffle className="size-5" aria-hidden="true" />
          {draft ? "Shuffle again" : "Shuffle"}
        </Button>
        {draft && (
          <Button
            size="lg"
            variant={published ? "outline" : "default"}
            onClick={() => setPublishing(true)}
            disabled={saving || blocked}
            aria-describedby={blocked ? blockedId : undefined}
          >
            {published ? "Publish changes" : "Publish tables"}
          </Button>
        )}
      </div>
      {blocked && (
        <p id={blockedId} className="text-lg text-muted-foreground">
          Every dinner needs a host, and every date needs tables, before you can publish.
        </p>
      )}

      {warnings && warnings.datesWithoutTables.length > 0 && (
        <p role="status" className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-lg">
          <TriangleAlert className="mt-1 size-5 shrink-0 text-destructive" aria-hidden="true" />
          No tables yet for {warnings.datesWithoutTables.map((d) => dateLabel.get(d)).join("; ")}. Shuffle again to add them.
        </p>
      )}

      {warnings?.tooFewHosts && (
        <p role="status" className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-lg">
          <TriangleAlert className="mt-1 size-5 shrink-0 text-destructive" aria-hidden="true" />
          Too few hosts for the table size. Some tables will have more people than seats.
        </p>
      )}
      {!published && unseated.length > 0 && (
        <p role="status" className="rounded-xl border border-border bg-muted p-4 text-lg">
          Not at a table: {unseated.map((p) => names[p.id]).join("; ")}. Shuffle again to seat them.
        </p>
      )}

      {waiting.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl font-bold">Waiting for a table</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-lg text-muted-foreground">
              Seat each party at a table with room. Nobody else moves, and only that table gets an email when you publish.
            </p>
            <ul className="divide-y divide-border rounded-xl border border-border">
              {waiting.map(({ dateId, party }) => {
                const room = tablesWithRoom(draft!, party, byId, tableSize.max, dateIds, future).filter(
                  (t) => t.seasonDateId === dateId
                );
                return (
                  <li key={`${dateId ?? "season"}-${party.id}`} className="space-y-3 p-4">
                    <p className="text-lg font-semibold">
                      {names[party.id]}
                      {dateId && <span className="ml-2 text-base font-normal text-muted-foreground">{dateLabel.get(dateId)}</span>}
                    </p>
                    {room.length > 0 ? (
                      <OptionSelect
                        id={`seat-${dateId ?? "season"}-${party.id}`}
                        label="Seat at"
                        items={room.map((t) => ({
                          value: t.key,
                          label: `Table ${tableNumber(t)} (${freeSeats(t, byId, tableSize.max)} free)`,
                        }))}
                        value={null}
                        placeholder="Choose a table"
                        disabled={saving || publishing}
                        onChange={(key) => void save(seatParty(draft!, party.id, key))}
                      />
                    ) : (
                      <p className="text-base text-muted-foreground">No table has room for them.</p>
                    )}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {!draft && (
        <p className="text-lg text-muted-foreground">
          Shuffle to make a draft of the tables. Only leaders see it until you publish.
        </p>
      )}

      {groupsOfTables.map(({ dateId, tables }) => (
        <section key={dateId ?? "season"} className="space-y-4">
          {dateId && <h2 className="text-2xl font-bold">{dateLabel.get(dateId)}</h2>}
          <div className="grid gap-6 lg:grid-cols-2">
            {tables.map((t, index) => {
              const w = warnings?.tables[t.key];
              const seats = tableSeats(t, byId);
              const others = tables.filter((o) => o.key !== t.key);
              const hostItems = t.partyIds
                .filter((id) => byId.get(id)?.canHost)
                .map((id) => ({ value: id, label: names[id] ?? "Party" }));
              // A held dinner keeps its host, so only dinners still to come offer one to pick.
              const isHeld = (d: string) => Boolean(t.tableId && held.has(dinnerKey(t.tableId, d)));
              const isCantHost = (d: string) => Boolean(t.tableId && dinnerKey(t.tableId, d) in cantHost);
              const picks = hostPicks(t, format, isHeld, isCantHost, dateLabel);
              const cantHostDates = t.hosts.filter((h) => isCantHost(h.seasonDateId));
              const needsHost = cantHostDates.length > 0 || Boolean(w?.noHost);
              return (
                <Card key={t.key}>
                  <CardHeader>
                    <CardTitle className="text-xl font-bold">
                      Table {index + 1}
                      <span className="ml-3 text-base font-normal text-muted-foreground">
                        {partyPeople(t, byId)} {seats ? `of ${seats} seats` : "people"}
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {w && (w.overSeats || w.noHost || w.repeatPairs.length > 0 || w.backToBack.length > 0) && (
                      <ul className="space-y-1 text-base font-semibold text-destructive">
                        {w.overSeats && <li>More people than seats</li>}
                        {w.noHost && <li>A dinner has no host</li>}
                        {w.repeatPairs.map(([a, b]) => (
                          <li key={`${a}${b}`}>
                            {names[a]} and {names[b]} already ate together
                          </li>
                        ))}
                        {w.backToBack.map((id) => (
                          <li key={id}>Two dinners in a row: {names[id]}</li>
                        ))}
                      </ul>
                    )}
                    <ul className="divide-y divide-border rounded-xl border border-border">
                      {t.partyIds.map((id) => {
                        const moves: Option[] = others.flatMap((o) => [
                          { value: `move:${o.key}`, label: `Move to Table ${tables.indexOf(o) + 1}` },
                          ...o.partyIds.map((other) => ({
                            value: `swap:${o.key}:${other}`,
                            label: `Swap with ${names[other] ?? "party"} (Table ${tables.indexOf(o) + 1})`,
                          })),
                        ]);
                        const hosting = t.hosts.some((h) => h.partyId === id);
                        return (
                          <li key={id} className="space-y-3 p-4">
                            <p className="text-lg font-semibold">
                              {names[id]}
                              {hosting && <span className="ml-2 text-base font-normal text-brand-primary-text">Host</span>}
                            </p>
                            {others.length > 0 && (
                              <OptionSelect
                                id={`move-${t.key}-${id}`}
                                label="Move or swap"
                                items={moves}
                                value={null}
                                placeholder="Choose"
                                disabled={saving || publishing}
                                onChange={(choice) => {
                                  const [kind, key, other] = choice.split(":");
                                  void save(
                                    kind === "move" ? moveParty(draft!, t.key, id, key) : swapParties(draft!, t.key, id, key, other)
                                  );
                                }}
                              />
                            )}
                          </li>
                        );
                      })}
                    </ul>
                    {cantHostDates.map((h) => {
                      const date = dateLabel.get(h.seasonDateId) ?? "this date";
                      const absent = cantHost[dinnerKey(t.tableId!, h.seasonDateId)];
                      const standIn = h.partyId && h.partyId !== absent ? h.partyId : null;
                      const standIns = hostItems.filter((o) => o.value !== absent);
                      const swaps = t.hosts
                        .filter(
                          (o) =>
                            o.seasonDateId !== h.seasonDateId &&
                            !isHeld(o.seasonDateId) &&
                            future.has(o.seasonDateId) &&
                            o.partyId &&
                            o.partyId !== absent &&
                            !isCantHost(o.seasonDateId)
                        )
                        .map((o) => ({ value: o.seasonDateId, label: `${dateLabel.get(o.seasonDateId)}: ${names[o.partyId!]}` }));
                      return (
                        <div key={h.seasonDateId} className="space-y-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4">
                          <p className="text-lg font-semibold">
                            {names[absent] ?? "The host"} can&apos;t host on {date}.
                          </p>
                          {standIn && (
                            <p className="text-base">{names[standIn]} hosts instead. Publish to tell the table.</p>
                          )}
                          {format === "same_table_rotating" && swaps.length > 0 && (
                            <OptionSelect
                              id={`swap-${t.key}-${h.seasonDateId}`}
                              label="Swap turns with"
                              items={swaps}
                              value={null}
                              placeholder="Choose a date"
                              disabled={saving || publishing}
                              onChange={(other) => void save(swapHostTurns(draft!, t.key, h.seasonDateId, other))}
                            />
                          )}
                          {format === "same_table_one_host" && standIns.length > 0 && (
                            <OptionSelect
                              id={`standin-${t.key}-${h.seasonDateId}`}
                              label={`Host on ${date}`}
                              items={standIns}
                              value={standIn}
                              placeholder="Choose a host"
                              disabled={saving || publishing}
                              onChange={(partyId) => void save(setTableHost(draft!, t.key, partyId, h.seasonDateId))}
                            />
                          )}
                          {format === "new_tables" && (
                            <Button
                              size="lg"
                              disabled={saving || publishing}
                              onClick={() => {
                                const moved = moveGuests(draft!, t.key, byId, tableSize.max, pastPairs);
                                if (moved.draft === draft) {
                                  toast.error(
                                    moved.noOtherTable
                                      ? `No other table on ${date}, so nobody was moved. Move the dinner instead.`
                                      : `Not enough room on ${date} for ${moved.unplaced.map((id) => names[id]).join("; ")}, so nobody was moved. Move or swap guests by hand, or move the dinner.`
                                  );
                                  return;
                                }
                                void save(moved.draft);
                              }}
                            >
                              Move guests
                            </Button>
                          )}
                          {format !== "new_tables" && (
                            <p className="text-base text-muted-foreground">Or move the dinner in the list of published dinners.</p>
                          )}
                        </div>
                      );
                    })}
                    {format === "same_table_one_host" &&
                      needsHost &&
                      t.partyIds
                        .filter((id) => !byId.get(id)?.canHost)
                        .map((id) => (
                          <div key={id} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <p className="text-base">{names[id]} didn&apos;t offer to host.</p>
                            <HostingDetailsDialog party={{ id, names: names[id] ?? "Party" }} seasonId={seasonId} groupId={groupId} />
                          </div>
                        ))}
                    {hostItems.length > 0 &&
                      picks.map((pick) => (
                        <OptionSelect
                          key={pick.id}
                          id={pick.id}
                          label={pick.label}
                          items={hostItems}
                          value={pick.partyId}
                          placeholder="Choose a host"
                          disabled={saving || publishing}
                          onChange={(partyId) =>
                            void save(pick.dateIds.reduce((d, dateId) => setTableHost(d, t.key, partyId, dateId), draft!))
                          }
                        />
                      ))}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      ))}

      <ConfirmDialog
        open={publishing}
        onOpenChange={setPublishing}
        title={published ? "Publish these changes?" : "Publish tables?"}
        description={
          published
            ? "Each person whose table or host changed gets one email. Nobody else does."
            : "Each person sees their own table and gets one email with their dinners, dates and host."
        }
        confirmLabel={published ? "Publish changes" : "Publish tables"}
        pendingLabel="Publishing…"
        confirmVariant="default"
        onConfirm={publish}
      />
      <ConfirmDialog
        open={confirmShuffle}
        onOpenChange={setConfirmShuffle}
        title="Shuffle published tables again?"
        description="This replaces the draft with new tables. Nothing changes for members until you publish."
        confirmLabel="Shuffle again"
        pendingLabel="Shuffling…"
        confirmVariant="default"
        onConfirm={async () => {
          await shuffleAgain();
          setConfirmShuffle(false);
        }}
      />
    </div>
  );
}
