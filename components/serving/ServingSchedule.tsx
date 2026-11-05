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
import { Segmented } from "@/components/ui/segmented";
import { toast } from "sonner";
import { failureMessage } from "@/lib/errorCopy";
import { CheckCircle2, X } from "lucide-react";
import { bookingMessage, type BookingOutcome } from "@/lib/serving/bookingOutcome";
import { formatMonth, formatMonthDay, formatServingDate, openDatesAfter } from "@/lib/serving/dates";
import { SignupChoices, signupTitle, type SignupChoice } from "./SignupChoices";

export interface ScheduleEntry {
  id: string;
  date: string;
  createdBy: string;
  attendeeIds: string[];
  /** The name others see: "David & Lena Reyes" */
  label: string;
  /** What the viewer sees on their own date: "You", "You & Ben" */
  ownLabel: string;
}

interface ServingScheduleProps {
  teamId: string;
  /** The team's dates from today on, "YYYY-MM-DD" */
  dates: string[];
  /** Today in the church's time zone, "YYYY-MM-DD" */
  today: string;
  entries: Record<string, ScheduleEntry>;
  userId: string;
  spouse: { id: string; name: string } | null;
  /** How many following weeks a sign-up offers, 0 to 3 */
  extraWeeks: number;
  canSignUp: boolean;
  canManage: boolean;
}

type Who = "both" | "me" | "spouse";

const TAKEN_COPY = { 409: "Someone just signed up for that date. Thank you anyway." };

/**
 * One line per date on one card per month, with Sign up on each open date —
 * deliberately not a month-grid calendar.
 */
export function ServingSchedule({
  teamId,
  dates,
  today,
  entries,
  userId,
  spouse,
  extraWeeks,
  canSignUp,
  canManage,
}: ServingScheduleProps) {
  const [asking, setAsking] = useState<{ date: string; extraDates: string[] } | null>(null);
  const [changing, setChanging] = useState<ScheduleEntry | null>(null);
  const [who, setWho] = useState<Who>("both");
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState<ScheduleEntry | null>(null);
  const router = useRouter();

  const isOpen = (date: string) => !entries[date];
  const isMine = (entry: ScheduleEntry) =>
    entry.attendeeIds.includes(userId) || entry.createdBy === userId;
  const short = (date: string) => formatMonthDay(date, today);

  async function signUp(date: string, choice: SignupChoice) {
    setBusy(true);
    try {
      const res = await fetch("/api/serving/signups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          groupId: teamId,
          serviceDate: date,
          attendeeProfileIds: choice.includeSpouse && spouse ? [userId, spouse.id] : [userId],
          extraDates: choice.extraDates,
        }),
      });
      if (res.ok) {
        const outcome = (await res.json()) as BookingOutcome;
        toast.success(bookingMessage(outcome, short));
      } else {
        toast.error(failureMessage("sign you up", res.status, TAKEN_COPY));
      }
    } catch {
      toast.error(failureMessage("sign you up", "network"));
    } finally {
      setBusy(false);
      setAsking(null);
    }
    router.refresh();
  }

  function handleSignUp(date: string) {
    const extraDates = openDatesAfter(date, dates, isOpen, extraWeeks);
    if (!spouse && extraDates.length === 0) {
      void signUp(date, { includeSpouse: false, extraDates: [] });
    } else {
      setAsking({ date, extraDates });
    }
  }

  function startChange(entry: ScheduleEntry) {
    const hasMe = entry.attendeeIds.includes(userId);
    const hasSpouse = !!spouse && entry.attendeeIds.includes(spouse.id);
    setWho(hasMe && hasSpouse ? "both" : hasSpouse ? "spouse" : "me");
    setChanging(entry);
  }

  async function saveChange() {
    if (!changing || !spouse) return;
    const attendeeProfileIds =
      who === "both" ? [userId, spouse.id] : who === "spouse" ? [spouse.id] : [userId];
    setBusy(true);
    try {
      const res = await fetch("/api/serving/signups", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signupId: changing.id, attendeeProfileIds }),
      });
      if (res.ok) {
        toast.success("Saved.");
        setChanging(null);
      } else {
        toast.error(failureMessage("change who's serving", res.status));
      }
    } catch {
      toast.error(failureMessage("change who's serving", "network"));
    } finally {
      setBusy(false);
    }
    router.refresh();
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
        setChanging(null);
        toast.success("Serving cancelled.");
      } else {
        toast.error(failureMessage("cancel this serving", res.status));
      }
    } catch {
      toast.error(failureMessage("cancel this serving", "network"));
    } finally {
      setBusy(false);
    }
    router.refresh();
  }

  const months = new Map<string, string[]>();
  for (const date of dates) {
    const key = date.slice(0, 7);
    months.set(key, [...(months.get(key) ?? []), date]);
  }

  const cancellingMine = cancelling !== null && isMine(cancelling);

  return (
    <div className="space-y-6">
      {dates.length === 0 && (
        <p className="text-base text-muted-foreground">No dates to sign up for.</p>
      )}

      {[...months.values()].map((monthDates) => (
        <section key={monthDates[0]} aria-label={formatMonth(monthDates[0], today)}>
          <h2 className="mb-2 text-base font-bold uppercase tracking-widest text-muted-foreground">
            {formatMonth(monthDates[0], today)}
          </h2>
          <Card>
            <CardContent className="divide-y divide-border p-0">
              {monthDates.map((date) => {
                const entry = entries[date];
                const mine = entry && isMine(entry);
                const label = formatServingDate(date, today);
                return (
                  <div key={date} className="flex min-h-16 items-center gap-4 px-4 py-2">
                    <p className="flex-1 shrink-0 text-lg font-semibold">{label}</p>

                    {!entry && canSignUp && (
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => handleSignUp(date)}
                        aria-label={`Sign up for ${label}`}
                      >
                        Sign up
                      </Button>
                    )}
                    {!entry && !canSignUp && <p className="text-base text-muted-foreground">Open</p>}

                    {entry && mine && (
                      <>
                        <p className="flex items-center gap-1.5 text-base font-semibold">
                          <CheckCircle2 className="h-5 w-5 shrink-0 text-brand-success" aria-hidden="true" />
                          {entry.ownLabel}
                        </p>
                        {spouse ? (
                          <Button
                            variant="outline"
                            disabled={busy}
                            onClick={() => startChange(entry)}
                            aria-label={`Change ${label}`}
                          >
                            Change
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            disabled={busy}
                            onClick={() => setCancelling(entry)}
                            aria-label={`Cancel serving for ${label}`}
                          >
                            Cancel
                          </Button>
                        )}
                      </>
                    )}

                    {entry && !mine && (
                      <>
                        <p className="min-w-0 text-right text-base text-muted-foreground">{entry.label}</p>
                        {canManage && (
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={busy}
                            onClick={() => setCancelling(entry)}
                            aria-label={`Remove ${entry.label} from ${label}`}
                            className="shrink-0 text-muted-foreground hover:text-destructive"
                          >
                            <X aria-hidden="true" />
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </section>
      ))}

      <Dialog open={!!asking} onOpenChange={(o) => !o && !busy && setAsking(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-xl">
              {asking ? signupTitle(asking.date, today, spouse?.name ?? null, asking.extraDates) : ""}
            </DialogTitle>
          </DialogHeader>
          {asking && (
            <SignupChoices
              date={asking.date}
              today={today}
              spouseName={spouse?.name ?? null}
              extraDates={asking.extraDates}
              busy={busy}
              onSubmit={(choice) => signUp(asking.date, choice)}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!changing} onOpenChange={(o) => !o && !busy && setChanging(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-xl">
              {changing ? formatServingDate(changing.date, today) : ""}
            </DialogTitle>
          </DialogHeader>
          {changing && spouse && (
            <div className="flex flex-col gap-5">
              <div className="space-y-2">
                <p className="text-base font-semibold">Who&apos;s serving?</p>
                <Segmented
                  label="Who's serving?"
                  options={[
                    { value: "both", label: `Me & ${spouse.name}` },
                    { value: "me", label: "Just me" },
                    { value: "spouse", label: `Just ${spouse.name}` },
                  ]}
                  value={who}
                  onChange={setWho}
                  className="w-full *:flex-1"
                />
              </div>
              <Button size="lg" disabled={busy} onClick={saveChange}>
                Save
              </Button>
              <Button size="lg" variant="outline" disabled={busy} onClick={() => setCancelling(changing)}>
                Cancel this date
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={cancelling !== null}
        onOpenChange={(open) => !open && !busy && setCancelling(null)}
        title={
          cancelling === null
            ? ""
            : cancellingMine
              ? `Cancel your serving for ${formatServingDate(cancelling.date, today)}?`
              : `Remove ${cancelling.label} from ${formatServingDate(cancelling.date, today)}?`
        }
        description={cancellingMine ? "That date will open back up for someone else." : undefined}
        confirmLabel={cancellingMine ? "Cancel serving" : "Remove from date"}
        pendingLabel="Cancelling…"
        cancelLabel="Keep serving"
        onConfirm={cancel}
      />
    </div>
  );
}
