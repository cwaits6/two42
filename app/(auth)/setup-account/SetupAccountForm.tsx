"use client";

import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { failureMessage } from "@/lib/errorCopy";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ErrorState } from "@/components/states/ErrorState";
import { AccountAgeNotice } from "../_components/AccountAgeNotice";
import { AuthShell } from "../_components/AuthShell";
import { AuthFormLoading } from "../_components/AuthFormLoading";
import { InvalidLink } from "../_components/InvalidLink";
import { NewPasswordFields } from "../_components/NewPasswordFields";
import { passwordFieldErrors, type PasswordFieldErrors } from "../_components/passwordRules";
import { useFieldFocus } from "../_components/useFieldFocus";
import { sanitizeNext } from "@/app/api/auth/callback/sanitize-next";
import { SETUP_STATUS, type SetupAccountResponse } from "@/app/api/auth/setup-response";
import { logError, logWarn } from "@/lib/log";

const TITLE = "Set up your account";

const LINK_CLASS =
  "font-semibold text-brand-primary-text underline underline-offset-4 hover:text-foreground";

// One wording for every dead link: a used link whose account was not created
// under the link's derived id looks the same as an unknown one.
const INVALID_HELP = (
  <>
    If you already set up your account,{" "}
    <Link href="/login" className={LINK_CLASS}>
      sign in
    </Link>
    . Otherwise ask your church admin for a new link.
  </>
);

interface SignupLink {
  name: string;
  email: string;
}

type View =
  | { kind: "verifying" }
  | { kind: "invalid" }
  | { kind: "failed" }
  | { kind: "set_up" }
  | { kind: "signed_up"; redirect: string }
  | { kind: "ready"; link: SignupLink };

export function SetupAccountForm() {
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<View>({ kind: "verifying" });
  const [attempt, setAttempt] = useState(0);
  const [errors, setErrors] = useState<PasswordFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [accountExists, setAccountExists] = useState(false);
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
        // A used link set up an account; if that account is signed in here,
        // Home is where it belongs.
        if (res.status === 404 || res.status === 409) {
          const { data } = await supabase.auth.getSession();
          if (data.session) {
            router.replace("/dashboard");
            return;
          }
        }
        setView(
          res.status === 409
            ? { kind: "set_up" }
            : { kind: res.status === 404 || res.status === 410 ? "invalid" : "failed" },
        );
        return;
      }

      const data = await res.json();
      setView({ kind: "ready", link: { name: data.name, email: data.email } });
    }
    verifyToken().catch((err) => {
      logError("Failed to verify the account setup link", err, { route: "/setup-account" });
      setView({ kind: "failed" });
    });
  }, [token, supabase, router, attempt]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (view.kind !== "ready") return;
    const link = view.link;
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
    setAccountExists(false);
    let res: Response;
    let body: SetupAccountResponse | Record<string, never>;
    try {
      res = await fetch("/api/auth/setup-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      body = await res.json().catch(() => ({}));
    } catch (err) {
      setLoading(false);
      logError("Failed to create the account", err, { route: "/setup-account" });
      setFormError(failureMessage("create your account", "network"));
      return;
    }

    if (!res.ok) {
      setLoading(false);
      if (res.status === 400 && "field" in body && body.field === "password") {
        setErrors({ password: body.error });
        focusField("password");
      } else if (res.status === 409 && "status" in body && body.status === SETUP_STATUS.setUp) {
        setView({ kind: "set_up" });
      } else if (res.status === 409 && "status" in body && body.status === SETUP_STATUS.accountExists) {
        setAccountExists(true);
        setFormError("An account already uses this email.");
      } else if (res.status === 404 || res.status === 410) {
        setView({ kind: "invalid" });
      } else {
        setFormError(failureMessage("create your account", res.status));
      }
      return;
    }

    const destination = sanitizeNext("redirect" in body ? body.redirect : null);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: link.email,
      password,
    });
    if (signInError) {
      setLoading(false);
      logWarn("Account created but sign-in failed", signInError, { route: "/setup-account" });
      setView({ kind: "signed_up", redirect: destination });
      return;
    }

    toast.success("Account created.");
    router.replace(destination);
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
    return <InvalidLink help={INVALID_HELP} />;
  }

  if (view.kind === "set_up" || view.kind === "signed_up") {
    const signIn =
      view.kind === "signed_up"
        ? `/login?redirect=${encodeURIComponent(view.redirect)}`
        : "/login";
    return (
      <AuthShell
        title={view.kind === "set_up" ? "Your account is already set up" : "Your account is set up"}
        kicker={
          view.kind === "set_up"
            ? "Sign in with your email and password."
            : "Sign in to continue."
        }
      >
        <Button
          size="lg"
          className="w-full font-semibold"
          nativeButton={false}
          render={<Link href={signIn} />}
        >
          Sign in
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={TITLE} kicker="Choose a password to sign in with from now on.">
      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        <div className="space-y-1.5">
          <Label
            htmlFor="email"
            className="font-sans text-lg font-semibold text-foreground"
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
            {accountExists && (
              <>
                {" "}
                <Link href="/login" className={LINK_CLASS}>
                  Sign in
                </Link>
              </>
            )}
          </p>
        )}
        <AccountAgeNotice />
        <Button type="submit" size="lg" className="w-full font-semibold" disabled={loading}>
          {loading ? "Creating account…" : "Create account"}
        </Button>
      </form>
    </AuthShell>
  );
}
