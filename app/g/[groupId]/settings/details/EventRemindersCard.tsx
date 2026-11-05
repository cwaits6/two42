"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { GROUP_REMINDER_ITEMS, reminderLabel, type GroupReminders } from "@/lib/events/reminders";
import { createClient } from "@/lib/supabase/client";

export function EventRemindersCard({
  groupId,
  initial,
}: {
  groupId: string;
  initial: GroupReminders;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [values, setValues] = useState(initial);
  const [saving, setSaving] = useState(false);

  // Each control saves on its own, and both wait while one is saving so a
  // failed save reverts to what is stored.
  async function save(change: Partial<GroupReminders>, saved: string) {
    const before = values;
    setValues({ ...before, ...change });
    setSaving(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    // A write the RLS policy rejects matches zero rows without an error.
    const { data, error } = await supabase
      .from("group_settings")
      .upsert({
        group_id: groupId,
        ...(change.enabled === undefined ? {} : { event_reminders_enabled: change.enabled }),
        ...(change.defaultDays === undefined ? {} : { event_reminder_default_days: change.defaultDays }),
        updated_by: user?.id,
        updated_at: new Date().toISOString(),
      })
      .select("group_id");
    setSaving(false);
    if (error || !data?.length) {
      setValues(before);
      toast.error("Couldn't save the event reminder setting. Please try again.");
      return;
    }
    toast.success(saved);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl font-bold text-foreground">Event reminders</CardTitle>
      </CardHeader>
      <CardContent className="divide-y divide-border">
        <div className="flex items-center justify-between gap-4 pb-4">
          <Label htmlFor="event_reminders_enabled" className="text-lg font-medium text-foreground">
            Send event reminders
          </Label>
          <Switch
            id="event_reminders_enabled"
            className="shrink-0"
            checked={values.enabled}
            disabled={saving}
            onCheckedChange={(next) =>
              save(
                { enabled: next },
                next ? "Event reminders are on for this group." : "Event reminders are off for this group."
              )
            }
          />
        </div>
        <div className="space-y-2 pt-4">
          <Label htmlFor="event_reminder_default_days" className="text-lg font-medium text-foreground">
            Default for new events
          </Label>
          <Select
            items={GROUP_REMINDER_ITEMS}
            value={String(values.defaultDays)}
            disabled={saving || !values.enabled}
            onValueChange={(next) => {
              const days = Number(next ?? values.defaultDays);
              if (days !== values.defaultDays) {
                save({ defaultDays: days }, `New events start on ${reminderLabel(days).toLowerCase()}.`);
              }
            }}
          >
            <SelectTrigger id="event_reminder_default_days" className="w-full text-lg sm:w-64">
              <SelectValue>{reminderLabel(values.defaultDays)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {GROUP_REMINDER_ITEMS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  );
}
