"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { FieldError, invalidFieldProps } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { failureMessage } from "@/lib/errorCopy";
import { useFieldFocus } from "@/app/(auth)/_components/useFieldFocus";
import { HOUSEHOLD_INVITE_INVALID_TEXT } from "./copy";

interface FamilyRequestFormProps {
  token: string;
  email: string;
}

const LABEL = "font-sans text-lg font-semibold tracking-[0.08em] uppercase text-foreground";
const NAME_REQUIRED = "Enter your name.";
const MESSAGES: Record<number, string> = {
  404: HOUSEHOLD_INVITE_INVALID_TEXT,
  409: "A request for this email is already in. A church admin will review it.",
};

export function FamilyRequestForm({ token, email }: FamilyRequestFormProps) {
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [nameError, setNameError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const focusField = useFieldFocus();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setNameError(NAME_REQUIRED);
      focusField("family-name");
      return;
    }
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
      if (res.status === 400) {
        setNameError(NAME_REQUIRED);
        focusField("family-name");
        return;
      }
      setError(MESSAGES[res.status] ?? failureMessage("send your request", res.status));
    } catch {
      setError(failureMessage("send your request", "network"));
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <div className="space-y-4" role="status">
        <p className="text-lg text-foreground">
          Request sent. A church admin will review it and email you a link to set up your account.
        </p>
        <Button
          size="lg"
          variant="outline"
          className="w-full font-semibold"
          nativeButton={false}
          render={<Link href="/" />}
        >
          Go to Home
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="family-name" className={LABEL}>
          Name
        </Label>
        <Input
          id="family-name"
          name="name"
          autoComplete="name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setNameError(undefined);
          }}
          placeholder="Your name"
          className="h-12 text-lg"
          {...invalidFieldProps("family-name", nameError)}
        />
        <FieldError fieldId="family-name" message={nameError} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="family-email" className={LABEL}>
          Email
        </Label>
        <Input id="family-email" value={email} readOnly className="h-12 text-lg" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="family-message" className={LABEL}>
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
      <Button type="submit" size="lg" className="w-full font-semibold" disabled={sending}>
        {sending ? "Sending…" : "Request access"}
      </Button>
    </form>
  );
}
