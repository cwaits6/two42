"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2 } from "lucide-react";
import { failureMessage } from "@/lib/errorCopy";

interface LinkActionConfirmProps {
  token: string;
  action: "signup" | "cancel";
  firstName: string;
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

  return (
    <div className="container mx-auto px-4 py-20 max-w-lg text-center">
      <Card className="p-8">
        <CardContent className="pt-6">
          {done ? (
            <>
              <CheckCircle2 className="h-12 w-12 text-green-600 mx-auto mb-4" />
              <h1 className="font-serif text-3xl text-brand-primary-text mb-4">
                {action === "signup" ? "You're all set!" : "Signup cancelled"}
              </h1>
              <p className="text-lg text-muted-foreground">
                {action === "signup"
                  ? `Thank you for serving with the ${teamName} on ${dateLabel}. A confirmation email with a calendar invitation is on its way.`
                  : `Your ${dateLabel} signup is cancelled and the Sunday is open for someone else. Thank you for letting us know.`}
              </p>
            </>
          ) : (
            <>
              <h1 className="font-serif text-3xl text-brand-primary-text mb-4">
                {action === "signup" ? `Serve on ${dateLabel}?` : "Can't make it?"}
              </h1>
              <p className="text-lg text-muted-foreground mb-8">
                {action === "signup"
                  ? `Hi ${firstName}! Tap a button below and ${dateLabel} with the ${teamName} is yours.`
                  : `Hi ${firstName}, tap the button to cancel your ${teamName} signup for ${dateLabel}. The Sunday will open back up for someone else.`}
              </p>

              <div className="flex flex-col gap-3">
                {action === "signup" ? (
                  <>
                    <Button
                      size="lg"
                      disabled={busy}
                      onClick={() => submit(false)}
                      className="text-lg py-6"
                    >
                      {spouseName ? "Just me" : "Yes, I'll serve"}
                    </Button>
                    {spouseName && (
                      <Button
                        size="lg"
                        disabled={busy}
                        onClick={() => submit(true)}
                        className="text-lg py-6"
                      >
                        Me &amp; {spouseName}
                      </Button>
                    )}
                  </>
                ) : (
                  <Button
                    size="lg"
                    disabled={busy}
                    onClick={() => submit(false)}
                    variant="destructive"
                    className="text-lg py-6"
                  >
                    Yes, cancel my signup
                  </Button>
                )}
              </div>

              {error && <p role="alert" className="text-destructive mt-4">{error}</p>}
            </>
          )}

          <Link
            href="/serving"
            className="inline-block mt-8 text-brand-primary-text hover:underline text-lg"
          >
            See the full serving schedule
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
