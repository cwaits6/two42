"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { AuthShell } from "../_components/AuthShell";

export default function ForgotPasswordPage() {
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const supabase = createClient();

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const email = formData.get("email") as string;

    // This is a public Supabase endpoint — no admin API needed.
    // Supabase sends the reset email via its built-in email system.
    // Always show success to prevent email enumeration.
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/api/auth/callback?next=/update-password`,
    });

    setLoading(false);
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <AuthShell
        eyebrow="CHECK YOUR EMAIL"
        title="We've sent a"
        em="reset link"
        kicker="If an account exists with that email, the link is on its way. It may take a minute to arrive."
        altPrompt="Remembered it?"
        altLabel="Back to sign in →"
        altHref="/login"
      >
        {/* No form in the success state — just the alt link above */}
        <div />
      </AuthShell>
    );
  }

  return (
    <AuthShell
      eyebrow="Reset password"
      title="Reset your"
      em="password"
      kicker="Enter your email and we'll send you a link to set a new password."
      altPrompt="Remembered it?"
      altLabel="Back to sign in →"
      altHref="/login"
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
            placeholder="your@email.com"
            className="h-12 text-lg"
          />
        </div>
        <Button
          type="submit"
          size="lg"
          className="w-full font-semibold"
          disabled={loading}
        >
          {loading ? "Sending…" : "Send Reset Link"}
        </Button>
      </form>
    </AuthShell>
  );
}
