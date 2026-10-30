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
import { CheckCircle2, X } from "lucide-react";
import { daysUntilService, formatServiceDate } from "@/lib/serving/sundays";

export interface ScheduleEntry {
  id: string;
  date: string;
  createdBy: string;
  attendeeIds: string[];
  label: string;
}

interface ServingScheduleProps {
  groupId: string;
  teamName: string;
  sundays: string[];
  entries: Record<string, ScheduleEntry>;
  userId: string;
  spouse: { id: string; name: string } | null;
  canSignUp: boolean;
  canManage: boolean;
}

/**
 * Vertical list of upcoming Sundays with one big "I'll do it" button per open
 * week — deliberately not a month-grid calendar.
 */
export function ServingSchedule({
  groupId,
  teamName,
  sundays,
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
        body: JSON.stringify({ groupId, serviceDate: date, attendeeProfileIds }),
      });

      if (res.ok) {
        toast.success(
          `You're signed up for ${formatServiceDate(date)}! A confirmation email is on its way.`
        );
      } else {
        const body = await res.json().catch(() => null);
        toast.error(body?.error || "Something went wrong — please try again.");
      }
    } catch {
      toast.error("Something went wrong — please try again.");
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
        const body = await res.json().catch(() => null);
        toast.error(body?.error || "Failed to cancel — please try again.");
      }
    } catch {
      toast.error("Failed to cancel — please try again.");
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
      {sundays.map((date) => {
        const entry = entries[date];
        const mine = entry && isMine(entry);
        const days = daysUntilService(date);

        return (
          <Card
            key={date}
            className={entry ? "bg-muted/40 py-8" : "border-brand-primary/30 py-8"}
          >
            <CardContent className="flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <p className="text-lg font-semibold">{formatServiceDate(date)}</p>
                {entry ? (
                  <p className="text-muted-foreground flex items-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                    {mine ? (
                      <span>
                        <strong>You&apos;re serving</strong>
                        {entry.attendeeIds.length > 1 ? ` — ${entry.label}` : ""}
                      </span>
                    ) : (
                      <span>{entry.label}</span>
                    )}
                  </p>
                ) : (
                  <p className="text-muted-foreground">
                    {days === 0 ? "Today — still open" : "Still needs someone"}
                  </p>
                )}
              </div>

              {!entry && canSignUp && (
                <Button
                  size="lg"
                  disabled={busy}
                  onClick={() => handleTake(date)}
                  className="text-lg px-6 py-6 shrink-0"
                >
                  I&apos;ll do it
                </Button>
              )}

              {entry && mine && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => setCancelling(entry)}
                  className="shrink-0"
                >
                  Can&apos;t make it?
                </Button>
              )}

              {entry && !mine && canManage && (
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={busy}
                  onClick={() => setCancelling(entry)}
                  aria-label={`Remove ${entry.label}`}
                  className="text-muted-foreground hover:text-destructive shrink-0"
                >
                  <X className="h-4 w-4" />
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
              {pickerDate ? formatServiceDate(pickerDate) : ""} — {teamName}
            </DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground">Who&apos;s coming?</p>
          <div className="flex flex-col gap-3 pt-2">
            <Button
              size="lg"
              disabled={busy}
              onClick={() => pickerDate && signUp(pickerDate, [userId])}
              className="text-lg py-6"
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
                className="text-lg py-6"
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
              ? `Cancel your signup for ${formatServiceDate(cancelling.date)}?`
              : `Remove ${cancelling.label} from ${formatServiceDate(cancelling.date)}?`
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
