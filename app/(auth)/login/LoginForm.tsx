"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { failureMessage } from "@/lib/errorCopy";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { AuthShell } from "../_components/AuthShell";

export function LoginForm() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();
  const searchParams = useSearchParams();
  const router = useRouter();
  const rawRedirect = searchParams.get("redirect") || "/dashboard";
  // Prevent open-redirect: canonicalize against a sentinel origin and accept
  // only same-origin, single-leading-slash paths.
  let redirect = "/dashboard";
  try {
    const url = new URL(rawRedirect, "http://_");
    if (
      url.origin === "http://_" &&
      url.pathname.startsWith("/") &&
      !url.pathname.startsWith("//")
    ) {
      redirect = url.pathname + url.search + url.hash;
    }
  } catch {
    // malformed redirect — fall back to default
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const formData = new FormData(e.currentTarget);
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setLoading(false);

    if (signInError) {
      setError(
        signInError.code === "invalid_credentials"
          ? "That email and password don't match. Try again, or reset your password."
          : failureMessage("sign you in", signInError.status),
      );
      return;
    }

    router.replace(redirect);
    router.refresh();
  };

  return (
    <AuthShell
      title="Sign in"
      altPrompt="No account yet?"
      altLabel="Use an invite link"
      altHref="/#invite"
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
        <div className="space-y-1.5">
          <Label
            htmlFor="password"
            className="font-sans text-lg font-semibold tracking-[0.08em] uppercase text-foreground"
          >
            Password
          </Label>
          <Input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            placeholder="Your password"
            className="h-12 text-lg"
          />
        </div>
        {error && (
          <p role="alert" className="text-base text-destructive">
            {error}
          </p>
        )}
        <Button
          type="submit"
          size="lg"
          className="w-full font-semibold"
          disabled={loading}
        >
          {loading ? "Signing in…" : "Sign in"}
        </Button>
        <p className="text-center">
          <Link
            href="/forgot-password"
            className="inline-flex min-h-11 items-center text-base font-semibold text-brand-primary-text underline underline-offset-4 hover:text-foreground"
          >
            Forgot your password?
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
