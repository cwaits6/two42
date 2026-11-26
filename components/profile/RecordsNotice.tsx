"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { failureMessage } from "@/lib/errorCopy";
import { logError } from "@/lib/log";

/**
 * Shown once, at the top of a person's own profile, after their church filled
 * in some of their details. `fields` are the filled details they may change,
 * each linking to its place in the form.
 */
export function RecordsNotice({
  profileId,
  fields,
}: {
  profileId: string;
  fields: { label: string; anchor: string }[];
}) {
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  if (!open) return null;

  async function dismiss() {
    setBusy(true);
    const { data, error } = await createClient()
      .from("records_person_state")
      .update({ notice_seen_at: new Date().toISOString() })
      .eq("profile_id", profileId)
      .select("profile_id");
    setBusy(false);
    if (error || !data?.length) {
      if (error) logError("Failed to dismiss the church records notice", error, { route: "/profile" });
      toast.error(failureMessage("save that"));
      return;
    }
    setOpen(false);
  }

  return (
    <section
      aria-labelledby="records-notice-title"
      className="mb-6 space-y-3 rounded-xl border border-brand-primary/25 bg-brand-warm p-5 sm:px-6"
    >
      <h2 id="records-notice-title" className="text-lg font-bold">
        Your church filled in some of your details from its records.
      </h2>
      {fields.length > 0 && (
        <>
          <p className="text-base">You can change or clear any of these:</p>
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {fields.map((field) => (
              <li key={field.anchor}>
                <a
                  href={`#${field.anchor}`}
                  className="inline-flex min-h-11 items-center text-base font-semibold text-brand-primary-text underline underline-offset-4"
                >
                  {field.label}
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
      <Button size="lg" variant="outline" onClick={dismiss} disabled={busy}>
        Got it
      </Button>
    </section>
  );
}
