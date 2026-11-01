"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { failureMessage } from "@/lib/errorCopy";
import { CheckCircle2, X } from "lucide-react";
import { daysUntil, formatServingDate } from "@/lib/serving/dates";

export interface ScheduleEntry {
  id: string;
  date: string;
  createdBy: string;
  attendeeIds: string[];
  label: string;
}

interface ServingScheduleProps {
  teamId: string;
  teamName: string;
  /** The upcoming dates in the team's window, "YYYY-MM-DD" */
  dates: string[];
  /** Today in the church's time zone, "YYYY-MM-DD" */
  today: string;
  entries: Record<string, ScheduleEntry>;
  userId: string;
  spouse: { id: string; name: string } | null;
  canSignUp: boolean;
  canManage: boolean;
}

/**
 * Vertical list of the team's upcoming dates with a Sign up button on each
 * open one — deliberately not a month-grid calendar.
 */
export function ServingSchedule({
  teamId,
  teamName,
  dates,
  today,
  entries,
  userId,
  spouse,
  canSignUp,
  canManage,
}: ServingScheduleProps) {
  const [pickerDate, setPickerDate] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState<ScheduleEntry | null>(null);
  const router = useRouter();

  async function signUp(date: string, attendeeProfileIds: string[]) {
    setBusy(true);
    try {
      const res = await fetch("/api/serving/signups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId: teamId, serviceDate: date, attendeeProfileIds }),
      });

      if (res.ok) {
        toast.success(
          `Signed up for ${formatServingDate(date, today)}. A confirmation email is on its way.`
        );
      } else {
        toast.error(failureMessage("sign you up", res.status, { 409: "Someone just signed up for that date. Thank you anyway." }));
      }
    } catch {
      toast.error(failureMessage("sign you up", "network"));
    } finally {
      setBusy(false);
      setPickerDate(null);
    }
    router.refresh();
  }

  function isMine(entry: ScheduleEntry) {
    return entry.attendeeIds.includes(userId) || entry.createdBy === userId;
  }

  async function cancel() {
    if (!cancelling) return;
    const entry = cancelling;
    setBusy(true);
    try {
      const res = await fetch("/api/serving/signups", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signupId: entry.id }),
      });

      if (res.ok) {
        setCancelling(null);
        toast.success("Signup cancelled.");
      } else {
        toast.error(failureMessage("cancel your signup", res.status));
      }
    } catch {
      toast.error(failureMessage("cancel your signup", "network"));
    } finally {
      setBusy(false);
    }
    router.refresh();
  }

  function handleTake(date: string) {
    if (spouse) {
      setPickerDate(date);
    } else {
      signUp(date, [userId]);
    }
  }

  const cancellingMine = cancelling !== null && isMine(cancelling);

  return (
    <div className="space-y-3">
      {dates.map((date) => {
        const entry = entries[date];
        const mine = entry && isMine(entry);
        const label = formatServingDate(date, today);

        return (
          <Card
            key={date}
            className={entry ? "bg-muted/40" : "border-brand-primary/30"}
          >
            <CardContent className="py-4 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <p className="text-lg font-semibold">{label}</p>
                {entry ? (
                  <p className="text-base text-muted-foreground flex items-center gap-1.5">
                    <CheckCircle2 className="h-5 w-5 text-brand-success shrink-0" aria-hidden="true" />
                    {mine ? (
                      <span>
                        <strong>You&apos;re serving</strong>
                        {entry.attendeeIds.length > 1 ? ` · ${entry.label}` : ""}
                      </span>
                    ) : (
                      <span>{entry.label}</span>
                    )}
                  </p>
                ) : (
                  <p className="text-base text-muted-foreground">
                    {daysUntil(date, today) === 0 ? "Today · still needs someone" : "Still needs someone"}
                  </p>
                )}
              </div>

              {!entry && canSignUp && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => handleTake(date)}
                  aria-label={`Sign up for ${label}`}
                  className="shrink-0"
                >
                  Sign up
                </Button>
              )}

              {entry && mine && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => setCancelling(entry)}
                  aria-label={`Cancel signup for ${label}`}
                  className="shrink-0"
                >
                  Cancel signup
                </Button>
              )}

              {entry && !mine && canManage && (
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={busy}
                  onClick={() => setCancelling(entry)}
                  aria-label={`Remove ${entry.label} from ${label}`}
                  className="text-muted-foreground hover:text-destructive shrink-0"
                >
                  <X aria-hidden="true" />
                </Button>
              )}
            </CardContent>
          </Card>
        );
      })}

      <Dialog
        open={!!pickerDate}
        onOpenChange={(o) => !o && !busy && setPickerDate(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-xl">
              Who&apos;s serving on {pickerDate ? formatServingDate(pickerDate, today) : ""}?
            </DialogTitle>
          </DialogHeader>
          <p className="text-base text-muted-foreground">{teamName}</p>
          <div className="flex flex-col gap-3 pt-2">
            <Button
              size="lg"
              disabled={busy}
              onClick={() => pickerDate && signUp(pickerDate, [userId])}
            >
              Just me
            </Button>
            {spouse && (
              <Button
                size="lg"
                disabled={busy}
                onClick={() =>
                  pickerDate && signUp(pickerDate, [userId, spouse.id])
                }
              >
                Me &amp; {spouse.name}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={cancelling !== null}
        onOpenChange={(open) => !open && !busy && setCancelling(null)}
        title={
          cancelling === null
            ? ""
            : cancellingMine
              ? `Cancel your signup for ${formatServingDate(cancelling.date, today)}?`
              : `Remove ${cancelling.label} from ${formatServingDate(cancelling.date, today)}?`
        }
        description={cancellingMine ? "That date will open back up for someone else." : undefined}
        confirmLabel={cancellingMine ? "Cancel signup" : "Remove signup"}
        pendingLabel="Cancelling…"
        cancelLabel="Keep signup"
        onConfirm={cancel}
      />
    </div>
  );
}
