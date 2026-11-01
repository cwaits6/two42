"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { failureMessage } from "@/lib/errorCopy";
import { AuthShell } from "../_components/AuthShell";

const BACK_TO_SIGN_IN = {
  altPrompt: "Remembered it?",
  altLabel: "Sign in",
  altHref: "/login",
} as const;

export function ForgotPasswordForm() {
  const [loading, setLoading] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const supabase = createClient();

  // Auth rate-limits recovery mail per account, so a 4xx (429 above all) would
  // say an account uses the email: treat it as sent. Only an unreachable or
  // failing auth server is reported.
  async function sendLink(email: string): Promise<boolean> {
    setLoading(true);
    setSendError(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/api/auth/callback?next=/update-password`,
    });
    setLoading(false);
    if (error) console.error(error);
    if (error && (!error.status || error.status >= 500)) {
      setSendError(failureMessage("send the link", error.status || "network"));
      return false;
    }
    return true;
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const email = (new FormData(e.currentTarget).get("email") as string).trim();
    if (await sendLink(email)) setSentTo(email);
  };

  async function sendAgain() {
    if (!sentTo) return;
    setResent(false);
    setResent(await sendLink(sentTo));
  }

  const sendErrorAlert = sendError && (
    <p role="alert" className="text-base text-destructive">
      {sendError}
    </p>
  );

  if (sentTo) {
    return (
      <AuthShell
        title="Check your email"
        kicker={
          <>
            If an account uses <span className="font-medium text-foreground">{sentTo}</span>, a
            link to choose a new password is on its way. It can take a few minutes, and may land
            in spam.
          </>
        }
        {...BACK_TO_SIGN_IN}
      >
        <div className="space-y-3">
          <Button
            variant="outline"
            size="lg"
            className="w-full font-semibold"
            onClick={sendAgain}
            disabled={loading}
          >
            {loading ? "Sending…" : "Send again"}
          </Button>
          {resent && (
            <p role="status" className="text-base text-muted-foreground">
              If an account uses this email, another link is on its way.
            </p>
          )}
          {sendErrorAlert}
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Reset your password"
      kicker="Enter your email and we'll send you a link to choose a new password."
      {...BACK_TO_SIGN_IN}
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-1.5">
          <Label
            htmlFor="email"
            className="font-sans text-lg font-semibold tracking-[0.08em] uppercase text-foreground"
          >
            Email
          </Label>
          <Input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="your@email.com"
            className="h-12 text-lg"
          />
        </div>
        {sendErrorAlert}
        <Button type="submit" size="lg" className="w-full font-semibold" disabled={loading}>
          {loading ? "Sending…" : "Send link"}
        </Button>
      </form>
    </AuthShell>
  );
}
