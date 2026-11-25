"use client";

import { useId, useMemo, useState } from "react";
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
  draftWarnings,
  moveParty,
  partyPeople,
  setTableHost,
  shuffle,
  swapParties,
  tableSeats,
  type DinnerFormat,
  type Draft,
  type DraftTable,
  type ShuffleParty,
} from "@/lib/dinnerClub/shuffle";
import { failureMessage } from "@/lib/errorCopy";
import { createClient } from "@/lib/supabase/client";

type Option = { value: string; label: string };

function OptionSelect({
  id,
  label,
  items,
  value,
  placeholder,
  onChange,
}: {
  id: string;
  label: string;
  items: Option[];
  value: string | null;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-base text-muted-foreground">
        {label}
      </Label>
      <Select items={items} value={value} onValueChange={(next) => next && onChange(next)}>
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
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(initialDraft);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [confirmShuffle, setConfirmShuffle] = useState(false);
  const dateIds = dates.map((d) => d.value);
  const dateLabel = new Map(dates.map((d) => [d.value, d.label]));
  const byId = useMemo(() => new Map(parties.map((p) => [p.id, p])), [parties]);
  const settings = { format, parties, dateIds, tableSize, allowBackToBack, pastPairs: [] };
  const warnings = draft ? draftWarnings(draft, settings) : null;
  const blocked = warnings ? blocksPublish(warnings) : false;
  const blockedId = useId();
  const unseated = draft
    ? parties.filter((p) => !draft.tables.some((t) => t.partyIds.includes(p.id)))
    : [];

  async function save(next: Draft): Promise<boolean> {
    setDraft(next);
    setSaving(true);
    const { data, error } = await createClient()
      .from("dinner_drafts")
      .upsert({ season_id: seasonId, group_id: groupId, body: JSON.parse(JSON.stringify(next)) }, { onConflict: "season_id" })
      .select("season_id");
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
      {unseated.length > 0 && (
        <p role="status" className="rounded-xl border border-border bg-muted p-4 text-lg">
          Not at a table: {unseated.map((p) => names[p.id]).join("; ")}. Shuffle again to seat them.
        </p>
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
              const hostDates = format === "same_table_rotating" ? t.hosts : t.hosts.slice(0, 1);
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
                    {hostItems.length > 0 &&
                      hostDates.map((h) => (
                        <OptionSelect
                          key={h.seasonDateId}
                          id={`host-${t.key}-${h.seasonDateId}`}
                          label={format === "same_table_rotating" ? `Host on ${dateLabel.get(h.seasonDateId) ?? "this date"}` : "Host"}
                          items={hostItems}
                          value={h.partyId}
                          placeholder="Choose a host"
                          onChange={(partyId) =>
                            void save(setTableHost(draft!, t.key, partyId, format === "same_table_rotating" ? h.seasonDateId : undefined))
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
