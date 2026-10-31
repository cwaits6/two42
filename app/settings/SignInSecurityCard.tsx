"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { normalizeEmail } from "@/lib/sanitize";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Check, KeyRound, Mail } from "lucide-react";
import { toast } from "sonner";

interface SignInSecurityCardProps {
  currentEmail: string;
}

function PasswordInput({
  id,
  value,
  onChange,
  autoComplete,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
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
        className="py-5 pr-20 text-base"
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md bg-brand-warm px-3 py-1.5 text-sm font-semibold text-brand-primary-text"
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
  const supabase = createClient();

  const togglePanel = (target: "password" | "email") =>
    setPanel((p) => (p === target ? "none" : target));

  const handlePasswordSave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      toast.error("Your new password needs at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("The new passwords don't match. Please type them again.");
      return;
    }

    setBusy(true);
    // Confirm it's really them before changing the password
    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email: currentEmail,
      password: currentPassword,
    });
    if (verifyError) {
      setBusy(false);
      toast.error("That current password doesn't look right.");
      return;
    }

    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setBusy(false);

    if (error) {
      console.error(error);
      toast.error("Failed to update your password. Please try again.");
      return;
    }

    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setPanel("none");
    toast.success("Your password has been updated.");
  };

  const handleEmailChange = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const email = normalizeEmail(newEmail);
    if (!email) {
      toast.error("Enter a valid email address.");
      return;
    }
    if (email === currentEmail.toLowerCase()) {
      toast.error("That's already your email address.");
      return;
    }

    setBusy(true);
    const { error } = await supabase.auth.updateUser({ email });
    setBusy(false);

    if (error) {
      console.error(error);
      toast.error("Failed to start the email change. Please try again.");
      return;
    }

    setNewEmail("");
    setPanel("none");
    toast.success(
      "Confirmation links sent. Check your old and new inboxes to finish the change.",
    );
  };

  return (
    <Card>
      <CardContent className="pt-6">
        <h3 className="mb-2">Sign in &amp; security</h3>
        <p className="mb-5 text-muted-foreground">
          You&apos;re signed in as{" "}
          <strong className="text-foreground">{currentEmail}</strong>
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            onClick={() => togglePanel("password")}
            aria-expanded={panel === "password"}
          >
            <KeyRound className="mr-2 h-4 w-4" />
            Change my password
          </Button>
          <Button
            variant="outline"
            onClick={() => togglePanel("email")}
            aria-expanded={panel === "email"}
          >
            <Mail className="mr-2 h-4 w-4" />
            Change my email
          </Button>
        </div>

        {panel === "password" && (
          <form
            onSubmit={handlePasswordSave}
            className="mt-6 space-y-5 border-t border-border pt-6"
          >
            <div className="space-y-2">
              <Label htmlFor="current-password" className="text-base">
                Current password
              </Label>
              <PasswordInput
                id="current-password"
                value={currentPassword}
                onChange={setCurrentPassword}
                autoComplete="current-password"
              />
              <p className="text-sm text-muted-foreground">
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
                onChange={setNewPassword}
                autoComplete="new-password"
              />
              <p className="text-sm text-muted-foreground">
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
                onChange={setConfirmPassword}
                autoComplete="new-password"
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={busy || !currentPassword || !newPassword}>
                <Check className="mr-2 h-4 w-4" />
                {busy ? "Saving..." : "Save my new password"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setPanel("none")}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}

        {panel === "email" && (
          <form
            onSubmit={handleEmailChange}
            className="mt-6 space-y-3 border-t border-border pt-6"
          >
            <Label htmlFor="new-email" className="text-base">
              New email address
            </Label>
            <p className="text-sm text-muted-foreground">
              We&apos;ll send confirmation links to your old and new addresses;
              the change happens after you click both.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Input
                id="new-email"
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="new.email@example.com"
                className="py-5 text-base"
              />
              <Button
                type="submit"
                variant="outline"
                disabled={busy || !newEmail}
                className="shrink-0"
              >
                <Mail className="mr-2 h-4 w-4" />
                {busy ? "Sending..." : "Send confirmation links"}
              </Button>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPanel("none")}
            >
              Cancel
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
