"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface DeleteEventDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Null for a one-off event. For a repeating event, how many of its dates are still to come, or null when it has no end. */
  series: { upcomingCount: number | null } | null;
  /** The date the form was opened for, when it was opened for one date of a repeating event. */
  occurrenceLabel: string | null;
  onDeleteDate: () => Promise<void>;
  onDeleteAll: () => Promise<void>;
}

function everyDateText(upcomingCount: number | null): string {
  if (upcomingCount === null) {
    return "This deletes every date of this repeating event, which has no end date.";
  }
  if (upcomingCount === 0) {
    return "This deletes every date of this repeating event. None are still to come.";
  }
  const dates = upcomingCount === 1 ? "date" : "dates";
  return `This deletes every date of this repeating event, including ${upcomingCount} ${dates} still to come.`;
}

// Same contract as ConfirmDialog: the caller closes the dialog once its action
// succeeds, a failed action leaves it open, and Escape and the overlay are
// ignored while the action runs. A repeating event opened for one date first
// asks which dates are meant; "All dates" then shows the every-date
// confirmation before anything is deleted.
export function DeleteEventDialog({
  open,
  onOpenChange,
  series,
  occurrenceLabel,
  onDeleteDate,
  onDeleteAll,
}: DeleteEventDialogProps) {
  const [pending, setPending] = useState(false);
  const [confirmingAll, setConfirmingAll] = useState(false);

  const choosing = series !== null && occurrenceLabel !== null && !confirmingAll;
  const everyDate = series !== null && !choosing;

  async function run(action: () => Promise<void>) {
    setPending(true);
    try {
      await action();
    } finally {
      setPending(false);
    }
  }

  function handleOpenChange(next: boolean) {
    if (!next && pending) return;
    if (!next) setConfirmingAll(false);
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {choosing ? "Delete which dates?" : everyDate ? "Delete every date?" : "Delete this event?"}
          </DialogTitle>
          <DialogDescription className="text-base">
            {choosing
              ? `This event repeats. Delete only the ${occurrenceLabel} date, or every date?`
              : everyDate
                ? everyDateText(series.upcomingCount)
                : "This can't be undone."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          {choosing ? (
            <>
              <Button variant="outline" onClick={() => setConfirmingAll(true)} disabled={pending}>
                All dates
              </Button>
              <Button variant="destructive" onClick={() => run(onDeleteDate)} disabled={pending}>
                {pending ? "Deleting…" : "This date only"}
              </Button>
            </>
          ) : (
            <Button variant="destructive" onClick={() => run(onDeleteAll)} disabled={pending}>
              {pending ? "Deleting…" : everyDate ? "Delete all dates" : "Delete event"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
