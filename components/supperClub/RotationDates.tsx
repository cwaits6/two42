"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { deletedNotice, movedNotice, type EmailOutcome } from "@/lib/supperClub/emailOutcome";
import { supperWhen, type RotationStatus } from "@/lib/supperClub/labels";
import { failureMessage } from "@/lib/errorCopy";
import { createClient } from "@/lib/supabase/client";
import { localToUTCISO } from "@/lib/time/zone";
import { MoveDialog, postMove } from "./MoveDialog";

type DateRow = { id: string; startsAt: string };

async function deleteDate(dateId: string): Promise<{ ok: true; outcome: EmailOutcome | null } | { ok: false; message?: string }> {
  try {
    const res = await fetch(`/api/supper-club/rotation-dates/${dateId}`, { method: "DELETE" });
    if (res.ok) return { ok: true, outcome: (await res.json().catch(() => null)) as EmailOutcome | null };
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, message: res.status === 400 ? body?.error : undefined };
  } catch {
    return { ok: false };
  }
}

export function RotationDates({
  groupId,
  rotationId,
  status,
  zone,
  dates,
  proposed,
}: {
  groupId: string;
  rotationId: string;
  status: RotationStatus;
  zone: string;
  dates: DateRow[];
  /** The dates the rotation's schedule proposes, for Propose dates again. */
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
      .from("supper_rotation_dates")
      .insert({ rotation_id: rotationId, group_id: groupId, starts_at: localToUTCISO(adding, zone) })
      .select("id");
    setAddPending(false);
    if (error?.code === "SC004") return toast.error("Choose a date within the rotation.");
    if (error || !data?.length) return toast.error(failureMessage("add the date"));
    setAdding("");
    toast.success(published ? "Date added. Publish the tables again to add its suppers." : "Date added.");
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
              <span className="text-lg">{supperWhen(d.startsAt, zone)}</span>
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
              ? "Each table's supper on this date moves too, unless its host already moved it. The people at those tables get an email."
              : "Choose the new date and time."
          }
          initialIso={moving.startsAt}
          zone={zone}
          onSave={async (startsAt) => {
            const result = await postMove(`/api/supper-club/rotation-dates/${moving.id}/move`, startsAt);
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
        description={
          published
            ? "Each table's supper on this date is deleted too. The people at those tables get an email saying it's off."
            : "It comes off the rotation's dates."
        }
        confirmLabel="Delete date"
        pendingLabel="Deleting…"
        onConfirm={async () => {
          if (!deleting) return;
          const result = await deleteDate(deleting.id);
          if (!result.ok) {
            toast.error(result.message ?? failureMessage("delete the date"));
            return;
          }
          setDeleting(null);
          const notice = deletedNotice(result.outcome);
          toast[notice.kind](notice.text);
          router.refresh();
        }}
      />

      <ConfirmDialog
        open={proposing}
        onOpenChange={setProposing}
        title="Propose dates again?"
        description={`The rotation's dates are replaced with ${proposed.length} from its start, end and how often.`}
        confirmLabel="Propose dates"
        pendingLabel="Proposing…"
        confirmVariant="default"
        onConfirm={async () => {
          const { data, error } = await createClient().rpc("supper_rotation_dates_replace", {
            _rotation_id: rotationId,
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
