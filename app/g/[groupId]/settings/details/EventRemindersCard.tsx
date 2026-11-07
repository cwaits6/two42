"use client";

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

export function EventRemindersCard({
  values,
  onChange,
}: {
  values: GroupReminders;
  onChange: (next: GroupReminders) => void;
}) {
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
            onCheckedChange={(enabled) => onChange({ ...values, enabled })}
          />
        </div>
        <div className="space-y-2 pt-4">
          <Label htmlFor="event_reminder_default_days" className="text-lg font-medium text-foreground">
            Default for new events
          </Label>
          <Select
            items={GROUP_REMINDER_ITEMS}
            value={String(values.defaultDays)}
            disabled={!values.enabled}
            onValueChange={(next) => onChange({ ...values, defaultDays: Number(next ?? values.defaultDays) })}
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
