"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface FamilyRequestFormProps {
  token: string;
  email: string;
}

const MESSAGES: Record<number, string> = {
  400: "Enter your name.",
  404: "This invite link is invalid or has expired.",
  409: "A request for this email is already in. An admin will review it.",
};
const FAILED = "We couldn't send your request right now. Try again in a few minutes.";

export function FamilyRequestForm({ token, email }: FamilyRequestFormProps) {
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSending(true);
    try {
      const res = await fetch("/api/family-invites/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, name: name.trim(), message: message.trim() }),
      });
      if (res.ok) {
        setSent(true);
        return;
      }
      setError(MESSAGES[res.status] ?? FAILED);
    } catch {
      setError(FAILED);
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <p role="status" className="text-lg text-foreground">
        Request sent. An admin will review it and email you a link to set up your account.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="space-y-1.5">
        <Label
          htmlFor="family-name"
          className="font-sans text-lg font-semibold tracking-[0.08em] uppercase text-foreground"
        >
          Name
        </Label>
        <Input
          id="family-name"
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
          htmlFor="family-email"
          className="font-sans text-lg font-semibold tracking-[0.08em] uppercase text-foreground"
        >
          Email
        </Label>
        <Input id="family-email" value={email} readOnly className="h-12 text-lg" />
      </div>
      <div className="space-y-1.5">
        <Label
          htmlFor="family-message"
          className="font-sans text-lg font-semibold tracking-[0.08em] uppercase text-foreground"
        >
          Message (optional)
        </Label>
        <Textarea
          id="family-message"
          name="message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={2000}
          rows={3}
          className="text-lg"
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
        {sending ? "Sending…" : "Request access"}
      </Button>
    </form>
  );
}
