"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { failureMessage } from "@/lib/errorCopy";
import { gradeFor, gradeLabel } from "@/lib/grade";
import type { SuggestedChild } from "@/lib/integrations/records/profileRecords";
import { logError } from "@/lib/log";
import { createClient } from "@/lib/supabase/client";

// Raised by records_add_suggested_child() and records_dismiss_suggested_child()
// for a suggestion that isn't this household's to decide, or is already decided.
const NOT_AVAILABLE = "RC001";

/** "Birthday March 3": never a year, which two42 doesn't keep for a suggested child. */
export function childDetails(child: SuggestedChild, today: Date): string[] {
  const details: string[] = [];
  if (child.birth_month && child.birth_day) {
    const day = new Date(Date.UTC(2000, child.birth_month - 1, child.birth_day));
    details.push(`Birthday ${day.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" })}`);
  }
  const grade = gradeFor(child.graduation_year, today);
  if (grade !== null) details.push(gradeLabel(grade));
  return details;
}

/** Children the church's records list in this household's family, for its primary and spouse to add or dismiss. */
export function SuggestedChildren({ suggestions, today }: { suggestions: SuggestedChild[]; today: Date }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [dismissing, setDismissing] = useState<SuggestedChild | null>(null);

  if (suggestions.length === 0) return null;

  async function decide(child: SuggestedChild, rpc: "records_add_suggested_child" | "records_dismiss_suggested_child") {
    setBusy(child.id);
    try {
      const { error } = await createClient().rpc(rpc, { _suggestion_id: child.id });
      if (error) {
        if (error.code === NOT_AVAILABLE) toast.error("This suggestion is no longer available.");
        else {
          logError("Suggested child decision failed", error, { route: "/profile", step: rpc });
          toast.error(failureMessage(rpc === "records_add_suggested_child" ? `add ${child.first_name}` : "dismiss this suggestion", 500));
        }
        router.refresh();
        return;
      }
      toast.success(
        rpc === "records_add_suggested_child"
          ? `Added ${child.first_name} to your household.`
          : `Dismissed. ${child.first_name} won't be suggested again.`,
      );
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="text-2xl">Suggested from your church&apos;s records</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-base text-muted-foreground">
          Your church lists these children in your family. Add them to your household, or dismiss them.
        </p>
        <ul className="divide-y divide-border">
          {suggestions.map((child) => (
            <li key={child.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:gap-4">
              <div className="min-w-0 flex-1">
                <p className="text-lg font-semibold">
                  {child.first_name} {child.last_name}
                </p>
                {childDetails(child, today).length > 0 && (
                  <p className="text-base text-muted-foreground">{childDetails(child, today).join(" · ")}</p>
                )}
              </div>
              <div className="flex flex-wrap gap-3">
                <Button size="lg" disabled={busy !== null} onClick={() => decide(child, "records_add_suggested_child")}>
                  Add to household
                </Button>
                <Button size="lg" variant="outline" disabled={busy !== null} onClick={() => setDismissing(child)}>
                  Dismiss
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
      <ConfirmDialog
        open={dismissing !== null}
        onOpenChange={(open) => !open && setDismissing(null)}
        title={dismissing ? `Dismiss ${dismissing.first_name}?` : "Dismiss?"}
        description="two42 won't suggest them again. You can still add them yourself."
        confirmLabel="Dismiss"
        pendingLabel="Dismissing…"
        confirmVariant="default"
        onConfirm={async () => {
          if (dismissing) await decide(dismissing, "records_dismiss_suggested_child");
          setDismissing(null);
        }}
      />
    </Card>
  );
}
