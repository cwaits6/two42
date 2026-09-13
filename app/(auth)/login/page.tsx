"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { AuthShell } from "../_components/AuthShell";
import { siteConfig } from "@/lib/config";
import { resolveOrgSlug } from "@/lib/org";

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
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

    const formData = new FormData(e.currentTarget);
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setLoading(false);

    if (error) {
      toast.error("Invalid email or password.");
      return;
    }

    router.replace(redirect);
    router.refresh();
  };

  return (
    <AuthShell
      eyebrow="Sign in"
      title="Sign in to"
      em={siteConfig.name}
      kicker="Sign in to see what's happening, who's coming, and what we're studying."
      altPrompt="New here?"
      altLabel="Request to join →"
      altHref={`/${resolveOrgSlug()}/join`}
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
            placeholder="Your password"
            className="h-12 text-lg"
          />
        </div>
        <Button
          type="submit"
          size="lg"
          className="w-full bg-brand-primary hover:bg-brand-primary/90 text-white font-semibold"
          disabled={loading}
        >
          {loading ? "Signing in…" : "Sign In"}
        </Button>
        <p className="text-sm text-muted-foreground text-center">
          <Link
            href="/forgot-password"
            className="text-brand-primary hover:underline font-medium"
          >
            Forgot your password?
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
