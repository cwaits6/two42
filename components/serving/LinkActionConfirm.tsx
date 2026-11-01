"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { failureMessage } from "@/lib/errorCopy";
import { ServingNotice, ServingPageLink } from "./ServingNotice";

interface LinkActionConfirmProps {
  token: string;
  action: "signup" | "cancel";
  /** Null when the person has no name on file yet */
  firstName: string | null;
  teamName: string;
  dateLabel: string;
  spouseName: string | null;
}

/** The one explicit button press between a signed email link and the action. */
export function LinkActionConfirm({
  token,
  action,
  firstName,
  teamName,
  dateLabel,
  spouseName,
}: LinkActionConfirmProps) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const verb = action === "signup" ? "sign you up" : "cancel your signup";
  const greeting = firstName ? `Hi ${firstName}. ` : "";

  async function submit(includeSpouse: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/serving/link-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, includeSpouse }),
      });

      if (res.ok) {
        setDone(true);
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

  if (done) {
    return action === "signup" ? (
      <ServingNotice
        title="You're signed up for"
        em={dateLabel}
        body={`Thank you for serving with ${teamName}. A confirmation email with a calendar invitation is on its way.`}
      />
    ) : (
      <ServingNotice
        title="Signup cancelled for"
        em={dateLabel}
        body="That date is open again for someone else. Thank you for letting us know."
      />
    );
  }

  return (
    <ServingNotice
      title={action === "signup" ? `Serve with ${teamName} on` : "Cancel your signup for"}
      em={dateLabel}
      body={
        action === "signup"
          ? spouseName
            ? `${greeting}Choose who is serving that day.`
            : `${greeting}Confirm below and ${dateLabel} with ${teamName} is yours.`
          : `${greeting}Confirm below to cancel your ${teamName} signup. ${dateLabel} will open up for someone else.`
      }
    >
      <div className="flex flex-col gap-3">
        {action === "signup" ? (
          <>
            <Button size="lg" disabled={busy} onClick={() => submit(false)}>
              {spouseName ? "Just me" : "Sign up"}
            </Button>
            {spouseName && (
              <Button size="lg" disabled={busy} onClick={() => submit(true)}>
                Me &amp; {spouseName}
              </Button>
            )}
          </>
        ) : (
          <Button size="lg" variant="destructive" disabled={busy} onClick={() => submit(false)}>
            Cancel signup
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
