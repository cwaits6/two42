"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { failureMessage } from "@/lib/errorCopy";
import type { MemberGroup } from "@/lib/types";

interface AdminServingSetupProps {
  groups: Pick<MemberGroup, "id" | "name" | "color">[];
}

/**
 * Leader-only: turn on Sunday serving signups for a team. This is where a
 * team becomes a "serving team" — the team dialog intentionally doesn't
 * expose it.
 */
export function AdminServingSetup({ groups }: AdminServingSetupProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const router = useRouter();
  const supabase = createClient();

  async function enable(groupId: string, name: string) {
    setBusy(groupId);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("serving_team_settings")
      .upsert({ team_id: groupId, enabled: true, updated_by: user?.id });
    setBusy(null);

    if (error) {
      console.error(error);
      toast.error(failureMessage(`turn on serving for ${name}`));
      return;
    }
    toast.success(`Serving signups enabled for ${name}.`);
    router.refresh();
  }

  return (
    <Card className="mt-10">
      <CardHeader>
        <CardTitle className="text-lg">Set up a serving team</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-4">
          Turn on serving signups for a team. Members of the team will be able
          to claim upcoming dates.
        </p>
        <div className="divide-y">
          {groups.map((g) => (
            <div key={g.id} className="flex items-center gap-3 py-2.5">
              <span
                className="inline-block w-3 h-3 rounded-full shrink-0"
                style={{ backgroundColor: g.color ?? "var(--color-brand-primary)" }}
              />
              <span className="flex-1 min-w-0 font-medium truncate">{g.name}</span>
              <Button
                variant="outline"
                size="default"
                disabled={busy === g.id}
                onClick={() => enable(g.id, g.name)}
              >
                Enable signups
              </Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
