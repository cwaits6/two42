"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BRING_ITEM_MAX, BRING_OPTIONS, bringItem, suggestBringList } from "@/lib/supperClub/bringList";
import { failureMessage } from "@/lib/errorCopy";
import { createClient } from "@/lib/supabase/client";

const OTHER = "other";
const NOTHING = "nothing";
const ITEMS = [
  ...BRING_OPTIONS.map((o) => ({ value: o as string, label: o as string })),
  { value: OTHER, label: "Something else" },
  { value: NOTHING, label: "Nothing" },
];

export interface BringGuest {
  partyId: string;
  names: string;
  item: string | null;
}

type Choice = { pick: string; text: string };

function choiceOf(item: string | null): Choice {
  if (!item) return { pick: NOTHING, text: "" };
  return (BRING_OPTIONS as readonly string[]).includes(item) ? { pick: item, text: "" } : { pick: OTHER, text: item };
}

function itemOf(choice: Choice): string | null {
  if (choice.pick === NOTHING) return null;
  return choice.pick === OTHER ? bringItem(choice.text) : choice.pick;
}

/** What guests bring, for a supper's host or a leader: set, change or clear each guest party's item. */
export function BringListDialog({
  supper,
  guests,
  earlier,
  supperIndex,
}: {
  supper: { id: string; rotationId: string; groupId: string; tableId: string; label: string };
  guests: BringGuest[];
  /** Each guest party's items at earlier suppers this rotation, oldest first, for Suggest. */
  earlier: Record<string, string[]>;
  supperIndex: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const set = (partyId: string, next: Partial<Choice>) =>
    setChoices((c) => ({ ...c, [partyId]: { ...c[partyId], ...next } }));
  const invalid = guests.some((g) => choices[g.partyId]?.pick === OTHER && !bringItem(choices[g.partyId].text));

  function start() {
    setChoices(Object.fromEntries(guests.map((g) => [g.partyId, choiceOf(g.item)])));
    setOpen(true);
  }

  function suggest() {
    const list = suggestBringList({ guestPartyIds: guests.map((g) => g.partyId), earlier, supperIndex });
    setChoices(Object.fromEntries(guests.map((g) => [g.partyId, choiceOf(list[g.partyId] ?? null)])));
  }

  async function save() {
    // A guest seated since the dialog opened has no choice yet; they keep their item.
    const choice = (g: (typeof guests)[number]) => choices[g.partyId] ?? choiceOf(g.item);
    const changed = guests.filter((g) => itemOf(choice(g)) !== g.item);
    const upserts = changed.flatMap((g) => {
      const item = itemOf(choice(g));
      return item
        ? [{ supper_id: supper.id, party_id: g.partyId, rotation_id: supper.rotationId, group_id: supper.groupId, table_id: supper.tableId, item }]
        : [];
    });
    const cleared = changed.filter((g) => itemOf(choice(g)) === null).map((g) => g.partyId);
    setSaving(true);
    const supabase = createClient();
    const [written, removed] = await Promise.all([
      upserts.length
        ? supabase.from("supper_contributions").upsert(upserts, { onConflict: "supper_id,party_id" }).select("party_id")
        : { data: [], error: null },
      cleared.length
        ? supabase.from("supper_contributions").delete().eq("supper_id", supper.id).in("party_id", cleared).select("party_id")
        : { data: [], error: null },
    ]);
    setSaving(false);
    // A filtered write that matched no row reports success; a count short of
    // what was sent is a refusal.
    if (written.error || removed.error || written.data?.length !== upserts.length || removed.data?.length !== cleared.length) {
      toast.error(failureMessage("save what guests bring"));
      router.refresh();
      return;
    }
    toast.success("Saved what guests bring.");
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button variant="outline" size="lg" onClick={start}>
        What guests bring
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>What guests bring</DialogTitle>
            <DialogDescription className="text-base">
              {supper.label}. Each guest sees what their party brings, and the reminder email says it.
            </DialogDescription>
          </DialogHeader>
          {guests.length === 0 ? (
            <p className="text-lg">No guests at this supper yet.</p>
          ) : (
            <div className="space-y-5">
              {guests.map((g) => {
                const choice = choices[g.partyId] ?? choiceOf(g.item);
                const id = `bring-${supper.id}-${g.partyId}`;
                return (
                  <div key={g.partyId} className="space-y-2">
                    <Label htmlFor={id} className="text-lg">
                      {g.names}
                    </Label>
                    <Select items={ITEMS} value={choice.pick} disabled={saving} onValueChange={(next) => next && set(g.partyId, { pick: next })}>
                      <SelectTrigger id={id} className="h-12 w-full text-lg">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ITEMS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {choice.pick === OTHER && (
                      <Input
                        aria-label={`What ${g.names} bring`}
                        placeholder="What they bring"
                        maxLength={BRING_ITEM_MAX}
                        value={choice.text}
                        disabled={saving}
                        className="h-12 text-lg"
                        onChange={(e) => set(g.partyId, { text: e.target.value })}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <div className="flex flex-col gap-3 sm:flex-row-reverse">
            <Button size="lg" onClick={save} disabled={saving || invalid || guests.length === 0}>
              {saving ? "Saving…" : "Save list"}
            </Button>
            <Button size="lg" variant="outline" onClick={suggest} disabled={saving || guests.length === 0}>
              Suggest
            </Button>
            <Button size="lg" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
