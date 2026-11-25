"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { movedNotice } from "@/lib/dinnerClub/emailOutcome";
import { dinnerWhen, type SeasonStatus } from "@/lib/dinnerClub/labels";
import { failureMessage } from "@/lib/errorCopy";
import { createClient } from "@/lib/supabase/client";
import { localToUTCISO } from "@/lib/time/zone";
import { MoveDialog, postMove } from "./MoveDialog";

type DateRow = { id: string; startsAt: string };

export function SeasonDates({
  groupId,
  seasonId,
  status,
  zone,
  dates,
  proposed,
}: {
  groupId: string;
  seasonId: string;
  status: SeasonStatus;
  zone: string;
  dates: DateRow[];
  /** The dates the season's schedule proposes, for Propose dates again. */
  proposed: string[];
}) {
  const router = useRouter();
  const addId = useId();
  const [adding, setAdding] = useState("");
  const [addPending, setAddPending] = useState(false);
  const [moving, setMoving] = useState<DateRow | null>(null);
  const [deleting, setDeleting] = useState<DateRow | null>(null);
  const [proposing, setProposing] = useState(false);
  const editable = status !== "ended";
  const published = status === "published";

  async function addDate() {
    if (!adding || addPending) return;
    setAddPending(true);
    const { data, error } = await createClient()
      .from("dinner_season_dates")
      .insert({ season_id: seasonId, group_id: groupId, starts_at: localToUTCISO(adding, zone) })
      .select("id");
    setAddPending(false);
    if (error?.code === "DC004") return toast.error("Choose a date within the season.");
    if (error || !data?.length) return toast.error(failureMessage("add the date"));
    setAdding("");
    toast.success(published ? "Date added. Publish the tables again to add its dinners." : "Date added.");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {dates.length === 0 ? (
        <p className="text-lg text-muted-foreground">No dates yet.</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {dates.map((d) => (
            <li key={d.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-lg">{dinnerWhen(d.startsAt, zone)}</span>
              {editable && (
                <div className="flex gap-3">
                  <Button variant="outline" size="lg" onClick={() => setMoving(d)}>
                    Move date
                  </Button>
                  <Button variant="outline" size="lg" onClick={() => setDeleting(d)}>
                    Delete date
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {editable && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="space-y-2">
            <Label htmlFor={addId} className="text-lg">
              New date
            </Label>
            <Input id={addId} type="datetime-local" value={adding} disabled={addPending} className="h-12 text-lg" onChange={(e) => setAdding(e.target.value)} />
          </div>
          <Button size="lg" variant="outline" onClick={addDate} disabled={!adding || addPending}>
            {addPending ? "Adding…" : "Add date"}
          </Button>
          {!published && (
            <Button size="lg" variant="outline" onClick={() => setProposing(true)}>
              Propose dates again
            </Button>
          )}
        </div>
      )}

      {moving && (
        <MoveDialog
          key={moving.id}
          open={Boolean(moving)}
          onOpenChange={(open) => {
            const row = moving;
            if (!open) setMoving((current) => (current === row ? null : current));
          }}
          title="Move date"
          description={
            published
              ? "Each table's dinner on this date moves too, unless its host already moved it. The people at those tables get an email."
              : "Choose the new date and time."
          }
          initialIso={moving.startsAt}
          zone={zone}
          onSave={async (startsAt) => {
            const result = await postMove(`/api/dinner-club/season-dates/${moving.id}/move`, startsAt);
            if (!result.ok) {
              toast.error(result.message ?? failureMessage("move the date"));
              return false;
            }
            const notice = movedNotice("Date moved.", result.outcome);
            toast[notice.kind](notice.text);
            router.refresh();
            return true;
          }}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete this date?"
        description={published ? "Each table's dinner on this date is deleted too." : "It comes off the season's dates."}
        confirmLabel="Delete date"
        pendingLabel="Deleting…"
        onConfirm={async () => {
          if (!deleting) return;
          const { data, error } = await createClient().from("dinner_season_dates").delete().eq("id", deleting.id).select("id");
          if (error || !data?.length) {
            toast.error(failureMessage("delete the date"));
            return;
          }
          setDeleting(null);
          toast.success("Date deleted.");
          router.refresh();
        }}
      />

      <ConfirmDialog
        open={proposing}
        onOpenChange={setProposing}
        title="Propose dates again?"
        description={`The season's dates are replaced with ${proposed.length} from its start, end and how often.`}
        confirmLabel="Propose dates"
        pendingLabel="Proposing…"
        confirmVariant="default"
        onConfirm={async () => {
          const { data, error } = await createClient().rpc("dinner_season_dates_replace", {
            _season_id: seasonId,
            _starts_at: proposed,
          });
          if (error || data !== proposed.length) {
            toast.error(failureMessage("replace the dates"));
            return;
          }
          setProposing(false);
          toast.success("Dates proposed.");
          router.refresh();
        }}
      />
    </div>
  );
}
