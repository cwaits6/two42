"use client";

import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { failureMessage } from "@/lib/errorCopy";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { AuthShell } from "../_components/AuthShell";
import { AuthFormLoading } from "../_components/AuthFormLoading";
import { NewPasswordFields } from "../_components/NewPasswordFields";
import {
  PASSWORD_AUTH_ERRORS,
  passwordFieldErrors,
  type PasswordFieldErrors,
} from "../_components/passwordRules";
import { useFieldFocus } from "../_components/useFieldFocus";

const TITLE = "Choose a new password";

export function UpdatePasswordForm() {
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [errors, setErrors] = useState<PasswordFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const focusField = useFieldFocus();
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
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (error) {
      setFormError(
        PASSWORD_AUTH_ERRORS[error.code ?? ""] ??
          failureMessage("change your password", error.status),
      );
      return;
    }

    toast.success("Password changed.");
    router.replace("/dashboard");
    router.refresh();
  };

  if (checkingSession) {
    return (
      <AuthShell title={TITLE}>
        <AuthFormLoading thing="your reset link" />
      </AuthShell>
    );
  }

  return (
    <AuthShell title={TITLE} kicker="Pick something you'll remember.">
      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        <NewPasswordFields
          label="New password"
          errors={errors}
          onEdit={(field) => setErrors((prev) => ({ ...prev, [field]: undefined }))}
        />
        {formError && (
          <p role="alert" className="text-base text-destructive">
            {formError}
          </p>
        )}
        <Button type="submit" size="lg" className="w-full font-semibold" disabled={loading}>
          {loading ? "Saving…" : "Save password"}
        </Button>
      </form>
    </AuthShell>
  );
}
