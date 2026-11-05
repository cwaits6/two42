"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { failureMessage } from "@/lib/errorCopy";

type Setting = "email_announcements" | "email_event_reminders";

const ROWS: { key: Setting; id: string; label: string }[] = [
  { key: "email_announcements", id: "email-announcements", label: "Email me new announcements" },
  { key: "email_event_reminders", id: "email-event-reminders", label: "Email me event reminders" },
];

interface NotificationsCardProps {
  userId: string;
  initial: Record<Setting, boolean>;
}

export function NotificationsCard({ userId, initial }: NotificationsCardProps) {
  const [values, setValues] = useState(initial);
  const [saving, setSaving] = useState(false);
  const supabase = createClient();

  // The switches are disabled while a save is pending, so updates can't
  // overlap and a stale response can't clobber a newer selection.
  const handleChange = async (key: Setting, next: boolean) => {
    setSaving(true);
    setValues((v) => ({ ...v, [key]: next }));
    // A write the RLS policy filters out matches zero rows without an error.
    const { data, error } = await supabase
      .from("profiles")
      .update({ [key]: next })
      .eq("id", userId)
      .select("id");
    if (error || !data?.length) {
      if (error) console.error(error);
      setValues((v) => ({ ...v, [key]: !next }));
      toast.error(failureMessage("save your email setting"));
    }
    setSaving(false);
  };

  return (
    <Card>
      <CardContent className="pt-6">
        <h2 className="mb-2 text-2xl">Notifications</h2>
        <p className="mb-4 text-base text-muted-foreground">Saved as soon as you change it.</p>
        <div className="divide-y divide-border">
          {ROWS.map((row) => (
            <div
              key={row.key}
              className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
            >
              <Label htmlFor={row.id} className="text-base font-semibold">
                {row.label}
              </Label>
              <Switch
                id={row.id}
                checked={values[row.key]}
                onCheckedChange={(next) => handleChange(row.key, next)}
                disabled={saving}
              />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
