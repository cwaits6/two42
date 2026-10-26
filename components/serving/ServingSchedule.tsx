"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
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

  async function cancel(entry: ScheduleEntry) {
    const mine = entry.attendeeIds.includes(userId) || entry.createdBy === userId;
    const message = mine
      ? `Cancel your signup for ${formatServiceDate(entry.date)}? That date will open back up for someone else.`
      : `Remove ${entry.label} from ${formatServiceDate(entry.date)}?`;
    if (!confirm(message)) return;

    setBusy(true);
    try {
      const res = await fetch("/api/serving/signups", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signupId: entry.id }),
      });

      if (res.ok) {
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

  return (
    <div className="space-y-3">
      {sundays.map((date) => {
        const entry = entries[date];
        const mine =
          entry &&
          (entry.attendeeIds.includes(userId) || entry.createdBy === userId);
        const days = daysUntilService(date);

        return (
          <Card
            key={date}
            className={entry ? "bg-muted/40" : "border-brand-primary/30"}
          >
            <CardContent className="py-4 flex items-center gap-4">
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
                  className="text-lg px-6 py-6 bg-brand-primary hover:bg-brand-primary/90 text-white shrink-0"
                >
                  I&apos;ll do it
                </Button>
              )}

              {entry && mine && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => cancel(entry)}
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
                  onClick={() => cancel(entry)}
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
              className="text-lg py-6 bg-brand-primary hover:bg-brand-primary/90 text-white"
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
                className="text-lg py-6 bg-brand-primary hover:bg-brand-primary/90 text-white"
              >
                Me &amp; {spouse.name}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
