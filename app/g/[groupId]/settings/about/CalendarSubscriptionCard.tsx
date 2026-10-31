"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { createClient } from "@/lib/supabase/client";

type Setting = "calendar_meeting_details" | "calendar_event_notes";

const ROWS: {
  key: Setting;
  label: string;
  description: string;
  on: string;
  off: string;
}[] = [
  {
    key: "calendar_meeting_details",
    label: "Join details",
    description: "The meeting link, ID and passcode of online events.",
    on: "Join details now go to members' calendars.",
    off: "Join details now stay on the event page.",
  },
  {
    key: "calendar_event_notes",
    label: "Notes and location",
    description: "Each event's description and location.",
    on: "Notes and locations now go to members' calendars.",
    off: "Notes and locations now stay on the event page.",
  },
];

export function CalendarSubscriptionCard({
  groupId,
  initial,
}: {
  groupId: string;
  initial: Record<Setting, boolean>;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [values, setValues] = useState(initial);
  const [saving, setSaving] = useState<Setting | null>(null);

  // Each switch saves on its own: one left unsaved would read as "kept out"
  // while subscriptions still carry it.
  async function toggle(key: Setting, next: boolean) {
    setValues((v) => ({ ...v, [key]: next }));
    setSaving(key);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    // A write the RLS policy rejects matches zero rows without an error.
    const { data, error } = await supabase
      .from("group_settings")
      .upsert({
        group_id: groupId,
        [key]: next,
        updated_by: user?.id,
        updated_at: new Date().toISOString(),
      })
      .select("group_id");
    setSaving(null);
    const row = ROWS.find((r) => r.key === key)!;
    if (error || !data?.length) {
      setValues((v) => ({ ...v, [key]: !next }));
      toast.error("Couldn't save the calendar setting. Please try again.");
      return;
    }
    toast.success(next ? row.on : row.off);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl text-brand-primary-text">Calendar subscriptions</CardTitle>
        <CardDescription className="text-base">
          What members&apos; calendar apps get when they subscribe to this group&apos;s calendar.
          Anything turned off is replaced by a link to the event page, where signed-in members see
          everything.
        </CardDescription>
      </CardHeader>
      <CardContent className="divide-y divide-border">
        {ROWS.map((row) => (
          <div
            key={row.key}
            className="flex items-start justify-between gap-4 py-4 first:pt-0 last:pb-0"
          >
            <div className="min-w-0">
              <Label htmlFor={row.key} className="text-lg font-medium text-foreground">
                {row.label}
              </Label>
              <p id={`${row.key}-help`} className="mt-1 text-base text-muted-foreground">
                {row.description}
              </p>
            </div>
            <Switch
              id={row.key}
              aria-describedby={`${row.key}-help`}
              className="mt-1 shrink-0"
              checked={values[row.key]}
              disabled={saving === row.key}
              onCheckedChange={(next) => toggle(row.key, next)}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
