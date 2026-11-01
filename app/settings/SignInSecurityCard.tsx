"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { normalizeEmail } from "@/lib/sanitize";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError, invalidFieldProps } from "@/components/ui/field-error";
import { failureMessage } from "@/lib/errorCopy";
import { Check, KeyRound, Mail } from "lucide-react";
import { toast } from "sonner";

interface SignInSecurityCardProps {
  currentEmail: string;
}

type Field = "current-password" | "new-password" | "confirm-password" | "new-email";
type FieldErrors = Partial<Record<Field, string>>;

function PasswordInput({
  id,
  value,
  onChange,
  autoComplete,
  error,
}: {
  id: Field;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  error: string | undefined;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        className="h-12 pr-24 text-base"
        {...invalidFieldProps(id, error)}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-pressed={show}
        aria-controls={id}
        className="absolute right-0.5 top-1/2 inline-flex min-h-11 min-w-16 -translate-y-1/2 items-center justify-center rounded-md px-3 text-base font-semibold text-brand-primary-text hover:bg-brand-warm"
      >
        {show ? "Hide" : "Show"}
      </button>
    </div>
  );
}

export function SignInSecurityCard({ currentEmail }: SignInSecurityCardProps) {
  const [panel, setPanel] = useState<"none" | "password" | "email">("none");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  // An object, so a second submit with the same first error still refocuses.
  const [focusTarget, setFocusTarget] = useState<{ id: Field } | null>(null);
  const supabase = createClient();

  // Focus waits for the render that ties the message to the field, so a
  // screen reader reads the message when focus lands.
  useEffect(() => {
    if (focusTarget) document.getElementById(focusTarget.id)?.focus();
  }, [focusTarget]);

  const togglePanel = (target: "password" | "email") => {
    setErrors({});
    setPanel((p) => (p === target ? "none" : target));
  };

  /** Shows the errors and focuses the first; true when there are none. */
  const accept = (found: FieldErrors) => {
    setErrors(found);
    const first = (Object.keys(found) as Field[])[0];
    if (first) setFocusTarget({ id: first });
    return !first;
  };

  const edit = (field: Field, set: (value: string) => void) => (value: string) => {
    set(value);
    setErrors((prev) => {
      if (!(field in prev)) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const handlePasswordSave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const found: FieldErrors = {};
    if (!currentPassword) found["current-password"] = "Enter your current password.";
    if (newPassword.length < 8) {
      found["new-password"] = "Enter a new password of at least 8 characters.";
    } else if (newPassword !== confirmPassword) {
      found["confirm-password"] = "Type the same new password again.";
    }
    if (!accept(found)) return;

    setBusy(true);
    // Confirm it's really them before changing the password
    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email: currentEmail,
      password: currentPassword,
    });
    if (verifyError) {
      setBusy(false);
      accept({ "current-password": "That isn't your current password. Try again." });
      return;
    }

    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setBusy(false);

    if (error) {
      console.error(error);
      toast.error(failureMessage("change your password"));
      return;
    }

    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setPanel("none");
    toast.success("Password changed.");
  };

  const handleEmailChange = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const email = normalizeEmail(newEmail);
    if (!email) {
      accept({ "new-email": "Enter an email address like name@example.com." });
      return;
    }
    if (email === currentEmail.toLowerCase()) {
      accept({ "new-email": "Enter an address other than the one you use now." });
      return;
    }

    setBusy(true);
    const { error } = await supabase.auth.updateUser({ email });
    setBusy(false);

    if (error) {
      console.error(error);
      toast.error(failureMessage("start the email change"));
      return;
    }

    setNewEmail("");
    setPanel("none");
    toast.success("Confirmation links sent to both addresses.");
  };

  return (
    <Card>
      <CardContent className="pt-6">
        <h2 className="mb-2 text-2xl">Sign-in and security</h2>
        <p className="mb-5 text-base text-muted-foreground">
          You&apos;re signed in as{" "}
          <strong className="text-foreground">{currentEmail}</strong>
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            onClick={() => togglePanel("password")}
            aria-expanded={panel === "password"}
          >
            <KeyRound className="mr-2 h-5 w-5" aria-hidden="true" />
            Change password
          </Button>
          <Button
            variant="outline"
            onClick={() => togglePanel("email")}
            aria-expanded={panel === "email"}
          >
            <Mail className="mr-2 h-5 w-5" aria-hidden="true" />
            Change email
          </Button>
        </div>

        {panel === "password" && (
          <form
            onSubmit={handlePasswordSave}
            noValidate
            className="mt-6 space-y-5 border-t border-border pt-6"
          >
            <div className="space-y-2">
              <Label htmlFor="current-password" className="text-base">
                Current password
              </Label>
              <PasswordInput
                id="current-password"
                value={currentPassword}
                onChange={edit("current-password", setCurrentPassword)}
                autoComplete="current-password"
                error={errors["current-password"]}
              />
              <FieldError fieldId="current-password" message={errors["current-password"]} />
              <p className="text-base text-muted-foreground">
                Can&apos;t remember it?{" "}
                <Link
                  href="/forgot-password"
                  className="font-semibold text-brand-primary-text underline underline-offset-2"
                >
                  We&apos;ll email you a link to reset it.
                </Link>
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="new-password" className="text-base">
                New password
              </Label>
              <PasswordInput
                id="new-password"
                value={newPassword}
                onChange={edit("new-password", setNewPassword)}
                autoComplete="new-password"
                error={errors["new-password"]}
              />
              <FieldError fieldId="new-password" message={errors["new-password"]} />
              <p className="text-base text-muted-foreground">
                At least 8 characters. Tip: a short phrase of a few unrelated
                words with a number or symbol is easy to remember and very
                strong.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirm-password" className="text-base">
                Type your new password again
              </Label>
              <PasswordInput
                id="confirm-password"
                value={confirmPassword}
                onChange={edit("confirm-password", setConfirmPassword)}
                autoComplete="new-password"
                error={errors["confirm-password"]}
              />
              <FieldError fieldId="confirm-password" message={errors["confirm-password"]} />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={busy}>
                <Check className="mr-2 h-5 w-5" aria-hidden="true" />
                {busy ? "Saving…" : "Save password"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => togglePanel("password")}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}

        {panel === "email" && (
          <form
            onSubmit={handleEmailChange}
            noValidate
            className="mt-6 space-y-5 border-t border-border pt-6"
          >
            <div className="space-y-2">
              <Label htmlFor="new-email" className="text-base">
                New email address
              </Label>
              <Input
                id="new-email"
                type="email"
                autoComplete="email"
                value={newEmail}
                onChange={(e) => edit("new-email", setNewEmail)(e.target.value)}
                className="h-12 text-base"
                {...invalidFieldProps("new-email", errors["new-email"])}
              />
              <FieldError fieldId="new-email" message={errors["new-email"]} />
              <p className="text-base text-muted-foreground">
                We&apos;ll email a confirmation link to your old and your new
                address. The change happens once you open both.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={busy}>
                <Mail className="mr-2 h-5 w-5" aria-hidden="true" />
                {busy ? "Sending…" : "Send confirmation links"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => togglePanel("email")}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
