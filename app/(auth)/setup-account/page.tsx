"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { failureMessage } from "@/lib/errorCopy";
import { useSearchParams, useRouter } from "next/navigation";
import { AuthShell } from "../_components/AuthShell";

const SIGN_UP_ERRORS: Record<string, string> = {
  user_already_exists: "An account already uses this email. Sign in instead.",
  weak_password: "Choose a stronger password: longer, with letters and numbers.",
};

export default function SetupAccountPage() {
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(true);
  const [tokenData, setTokenData] = useState<{
    name: string;
    email: string;
    invite_token: string | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token");

  useEffect(() => {
    async function verifyToken() {
      if (!token) {
        setError("No signup token provided.");
        setVerifying(false);
        return;
      }

      const res = await fetch("/api/auth/verify-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });

      if (!res.ok) {
        setError(
          failureMessage("open this signup link", res.status, {
            404: "This signup link isn't valid.",
            410: "This signup link has expired.",
          }),
        );
        setVerifying(false);
        return;
      }

      const data = await res.json();
      setTokenData({
        name: data.name,
        email: data.email,
        invite_token: data.invite_token ?? null,
      });
      setVerifying(false);
    }
    verifyToken();
  }, [token]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!tokenData) return;
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const password = formData.get("password") as string;
    const confirmPassword = formData.get("confirmPassword") as string;

    if (password.length < 8) {
      toast.error("Password must be at least 8 characters.");
      setLoading(false);
      return;
    }

    if (password !== confirmPassword) {
      toast.error("Passwords do not match.");
      setLoading(false);
      return;
    }

    const { error } = await supabase.auth.signUp({
      email: tokenData.email,
      password,
      options: {
        data: { full_name: tokenData.name },
      },
    });

    setLoading(false);

    if (error) {
      console.error(error);
      toast.error(
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

    toast.success("Account created. Welcome.");
    router.replace("/dashboard");
    router.refresh();
  };

  // ── Verifying state ──
  if (verifying) {
    return (
      <AuthShell
        eyebrow="Set up account"
        title="Verifying your"
        em="invite"
        kicker="Just confirming this link is good…"
      >
        <div className="flex items-center gap-2 text-muted-foreground font-sans text-sm py-2">
          <svg
            className="animate-spin h-4 w-4 text-brand-primary"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          Checking…
        </div>
      </AuthShell>
    );
  }

  // ── Error state ──
  if (error) {
    return (
      <AuthShell
        eyebrow="Set up account"
        title="This link doesn't"
        em="look right"
        kicker={error}
      >
        <p className="font-sans text-sm text-muted-foreground">
          Ask a church admin for a new invitation.
        </p>
      </AuthShell>
    );
  }

  // ── Normal form state ──
  return (
    <AuthShell
      eyebrow="Set up account"
      title="Set up your"
      em="account"
      kicker="Almost there — pick a password so you can sign in next time."
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
            type="email"
            value={tokenData?.email || ""}
            disabled
            className="h-12 text-lg bg-muted"
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
            minLength={8}
            placeholder="At least 8 characters"
            className="h-12 text-lg"
          />
        </div>
        <div className="space-y-1.5">
          <Label
            htmlFor="confirmPassword"
            className="font-sans text-lg font-semibold tracking-[0.08em] uppercase text-foreground"
          >
            Confirm Password
          </Label>
          <Input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            required
            minLength={8}
            placeholder="Confirm your password"
            className="h-12 text-lg"
          />
        </div>
        <Button
          type="submit"
          size="lg"
          className="w-full font-semibold"
          disabled={loading}
        >
          {loading ? "Creating account…" : "Create Account"}
        </Button>
      </form>
    </AuthShell>
  );
}
