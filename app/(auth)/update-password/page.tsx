"use client";

import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { AuthShell } from "../_components/AuthShell";

export default function UpdatePasswordPage() {
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();

  useEffect(() => {
    async function checkSession() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/login");
        return;
      }
      setCheckingSession(false);
    }
    checkSession();
  }, [supabase, router]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
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

    const { error } = await supabase.auth.updateUser({ password });

    setLoading(false);

    if (error) {
      toast.error("Failed to update password. Please try again.");
      return;
    }

    toast.success("Password updated successfully!");
    router.replace("/dashboard");
    router.refresh();
  };

  // While checking session, render nothing (avoids flash of form)
  if (checkingSession) {
    return null;
  }

  return (
    <AuthShell
      eyebrow="Choose password"
      title="Choose a"
      em="new password"
      kicker="Pick something you'll remember — at least 8 characters."
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-1.5">
          <Label
            htmlFor="password"
            className="font-sans text-lg font-semibold tracking-[0.08em] uppercase text-foreground"
          >
            New Password
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
          {loading ? "Updating…" : "Update Password"}
        </Button>
      </form>
    </AuthShell>
  );
}
