"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { failureMessage } from "@/lib/errorCopy";
import { bookingMessage, type BookingOutcome } from "@/lib/serving/bookingOutcome";
import { formatMonthDay, formatServingDate } from "@/lib/serving/dates";
import { ServingNotice, ServingPageLink } from "./ServingNotice";
import { SignupChoices, signupTitle, type SignupChoice } from "./SignupChoices";

interface LinkActionConfirmProps {
  token: string;
  action: "signup" | "cancel";
  teamName: string;
  date: string;
  /** Today in the church's time zone, "YYYY-MM-DD" */
  today: string;
  /** The spouse's first name, or null when there is nobody to ask about */
  spouseName: string | null;
  /** The open dates directly after `date` the team asks about */
  extraDates: string[];
}

/** The one explicit button press between a signed email link and the action. */
export function LinkActionConfirm({
  token,
  action,
  teamName,
  date,
  today,
  spouseName,
  extraDates,
}: LinkActionConfirmProps) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const verb = action === "signup" ? "sign you up" : "cancel your serving";
  const dateLabel = formatServingDate(date, today);

  async function submit(choice: SignupChoice) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/serving/link-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, includeSpouse: choice.includeSpouse, extraDates: choice.extraDates }),
      });

      if (res.ok) {
        const body = (await res.json()) as { outcome?: BookingOutcome };
        setDone(
          body.outcome
            ? bookingMessage(body.outcome, (d) => formatMonthDay(d, today))
            : "That date is open again for someone else. Thank you for letting us know.",
        );
      } else {
        setError(
          failureMessage(verb, res.status, {
            400: "This link no longer works. Sign in to change your serving from the site.",
            409: "Someone just signed up for that date. Thank you anyway.",
          }),
        );
      }
    } catch {
      setError(failureMessage(verb, "network"));
    } finally {
      setBusy(false);
    }
  }

  if (done !== null) {
    return action === "signup" ? (
      <ServingNotice
        title="Thank you for serving with"
        em={teamName}
        body={`${done} A confirmation email with a calendar invitation is on its way.`}
      />
    ) : (
      <ServingNotice title="Serving cancelled for" em={dateLabel} body={done} />
    );
  }

  const asks = spouseName !== null || extraDates.length > 0;

  return (
    <ServingNotice
      title={
        action === "signup"
          ? asks
            ? signupTitle(date, today, spouseName, extraDates)
            : `Serve with ${teamName} on`
          : "Cancel your serving for"
      }
      em={action === "signup" && asks ? "" : dateLabel}
      body=""
    >
      <div className="flex flex-col gap-3">
        {action === "signup" ? (
          asks ? (
            <SignupChoices
              date={date}
              today={today}
              spouseName={spouseName}
              extraDates={extraDates}
              busy={busy}
              onSubmit={submit}
            />
          ) : (
            <Button size="lg" disabled={busy} onClick={() => submit({ includeSpouse: false, extraDates: [] })}>
              Sign up
            </Button>
          )
        ) : (
          <Button
            size="lg"
            variant="destructive"
            disabled={busy}
            onClick={() => submit({ includeSpouse: false, extraDates: [] })}
          >
            Cancel serving
          </Button>
        )}

        {error && <p role="alert" className="text-base text-destructive">{error}</p>}

        <div className="mt-3">
          <ServingPageLink />
        </div>
      </div>
    </ServingNotice>
  );
}
