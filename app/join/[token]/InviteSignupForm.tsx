"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { INVITE_INVALID_TEXT } from "@/lib/groups/invites";

interface InviteSignupFormProps {
  token: string;
  groupName: string;
}

const MESSAGES: Record<number, string> = {
  400: "Enter your name and a valid email address.",
  404: INVITE_INVALID_TEXT,
  409: "We can't set up an account for that email address. If you already have an account, sign in and open this link again.",
};
const SEND_FAILED = "We couldn't send the email right now. Try again in a few minutes.";

export function InviteSignupForm({ token, groupName }: InviteSignupFormProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSending(true);
    try {
      const res = await fetch(`/api/join/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim() }),
      });
      if (res.ok) {
        setSentTo(email.trim());
        return;
      }
      setError(MESSAGES[res.status] ?? SEND_FAILED);
    } catch {
      setError(SEND_FAILED);
    } finally {
      setSending(false);
    }
  }

  if (sentTo) {
    return (
      <div className="space-y-3" role="status">
        <p className="text-xl font-semibold text-foreground">Check your email</p>
        <p className="text-lg text-muted-foreground">
          We sent a link to <span className="font-medium text-foreground">{sentTo}</span> to set
          up your account. Open it to finish joining {groupName}.
        </p>
        <p className="text-base text-muted-foreground">
          Didn&apos;t get it? Check your spam folder, or submit the form again.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="space-y-1.5">
        <Label
          htmlFor="invite-name"
          className="font-sans text-lg font-semibold tracking-[0.08em] uppercase text-foreground"
        >
          Name
        </Label>
        <Input
          id="invite-name"
          name="name"
          required
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          className="h-12 text-lg"
        />
      </div>
      <div className="space-y-1.5">
        <Label
          htmlFor="invite-email"
          className="font-sans text-lg font-semibold tracking-[0.08em] uppercase text-foreground"
        >
          Email
        </Label>
        <Input
          id="invite-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="your@email.com"
          className="h-12 text-lg"
        />
      </div>
      {error ? (
        <p role="alert" className="text-base text-destructive">
          {error}
        </p>
      ) : null}
      <Button
        type="submit"
        size="lg"
        className="w-full bg-brand-primary text-white hover:bg-brand-primary/90 font-semibold"
        disabled={sending}
      >
        {sending ? "Sending…" : "Continue"}
      </Button>
    </form>
  );
}
