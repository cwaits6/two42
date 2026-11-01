"use client";

import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { failureMessage } from "@/lib/errorCopy";
import { useSearchParams, useRouter } from "next/navigation";
import { ErrorState } from "@/components/states/ErrorState";
import { AuthShell } from "../_components/AuthShell";
import { AuthFormLoading } from "../_components/AuthFormLoading";
import { InvalidLink } from "../_components/InvalidLink";
import { CHURCH_ADMIN_INVALID_HELP } from "@/lib/groups/invites";
import { NewPasswordFields } from "../_components/NewPasswordFields";
import {
  PASSWORD_AUTH_ERRORS,
  passwordFieldErrors,
  type PasswordFieldErrors,
} from "../_components/passwordRules";
import { useFieldFocus } from "../_components/useFieldFocus";

const SIGN_UP_ERRORS: Record<string, string> = {
  ...PASSWORD_AUTH_ERRORS,
  user_already_exists: "An account already uses this email. Sign in instead.",
};

const TITLE = "Set up your account";

interface SignupLink {
  name: string;
  email: string;
  invite_token: string | null;
}

type View =
  | { kind: "verifying" }
  | { kind: "invalid" }
  | { kind: "failed" }
  | { kind: "ready"; link: SignupLink };

export function SetupAccountForm() {
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<View>({ kind: "verifying" });
  const [attempt, setAttempt] = useState(0);
  const [errors, setErrors] = useState<PasswordFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const focusField = useFieldFocus();
  const supabase = useMemo(() => createClient(), []);
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token");

  useEffect(() => {
    async function verifyToken() {
      if (!token) {
        setView({ kind: "invalid" });
        return;
      }

      const res = await fetch("/api/auth/verify-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });

      if (!res.ok) {
        // A link that has been used set up an account; if that account is
        // signed in here, Home is where it belongs.
        if (res.status === 404) {
          const { data } = await supabase.auth.getSession();
          if (data.session) {
            router.replace("/dashboard");
            return;
          }
        }
        setView({ kind: res.status === 404 || res.status === 410 ? "invalid" : "failed" });
        return;
      }

      const data = await res.json();
      setView({
        kind: "ready",
        link: { name: data.name, email: data.email, invite_token: data.invite_token ?? null },
      });
    }
    verifyToken().catch((err) => {
      console.error(err);
      setView({ kind: "failed" });
    });
  }, [token, supabase, router, attempt]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (view.kind !== "ready") return;
    const tokenData = view.link;
    setFormError(null);

    const formData = new FormData(e.currentTarget);
    const password = formData.get("password") as string;
    const found = passwordFieldErrors(password, formData.get("confirmPassword") as string);
    setErrors(found);
    const firstInvalid = Object.keys(found)[0];
    if (firstInvalid) {
      focusField(firstInvalid);
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email: tokenData.email,
      password,
      options: {
        data: { full_name: tokenData.name },
      },
    });

    if (error) {
      setLoading(false);
      console.error(error);
      setFormError(
        SIGN_UP_ERRORS[error.code ?? ""] ?? failureMessage("create your account", error.status),
      );
      return;
    }

    // Invalidate the signup token so it cannot be reused
    await fetch("/api/auth/consume-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });

    // If this signup came from a family invite link, claim the invite now
    // so the new profile is linked to the household automatically.
    if (tokenData.invite_token) {
      try {
        const claimRes = await fetch("/api/family-invites/claim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ invite_token: tokenData.invite_token }),
        });
        if (!claimRes.ok) {
          const text = await claimRes.text().catch(() => "");
          console.warn("Failed to claim family invite after signup — status %s: %s", claimRes.status, text);
        }
      } catch {
        // Non-fatal — the account is created; an admin can link the family manually
        console.warn("Failed to claim family invite after signup");
      }
    }

    toast.success("Account created.");
    router.replace("/dashboard");
    router.refresh();
  };

  if (view.kind === "verifying") {
    return (
      <AuthShell title={TITLE}>
        <AuthFormLoading thing="your signup link" />
      </AuthShell>
    );
  }

  if (view.kind === "failed") {
    return (
      <AuthShell title={TITLE}>
        <ErrorState
          thing="this signup link"
          onRetry={() => {
            setView({ kind: "verifying" });
            setAttempt((n) => n + 1);
          }}
        />
      </AuthShell>
    );
  }

  if (view.kind === "invalid") {
    return <InvalidLink help={CHURCH_ADMIN_INVALID_HELP} />;
  }

  return (
    <AuthShell title={TITLE} kicker="Choose a password to sign in with from now on.">
      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        <div className="space-y-1.5">
          <Label
            htmlFor="email"
            className="font-sans text-lg font-semibold tracking-[0.08em] uppercase text-foreground"
          >
            Email
          </Label>
          <Input
            id="email"
            type="email"
            value={view.link.email}
            disabled
            className="h-12 text-lg bg-muted"
          />
        </div>
        <NewPasswordFields
          label="Password"
          errors={errors}
          onEdit={(field) => setErrors((prev) => ({ ...prev, [field]: undefined }))}
        />
        {formError && (
          <p role="alert" className="text-base text-destructive">
            {formError}
          </p>
        )}
        <Button type="submit" size="lg" className="w-full font-semibold" disabled={loading}>
          {loading ? "Creating account…" : "Create account"}
        </Button>
      </form>
    </AuthShell>
  );
}
