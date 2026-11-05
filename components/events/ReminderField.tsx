"use client";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { REMINDER_ITEMS, reminderLabel } from "@/lib/events/reminders";

interface ReminderFieldProps {
  /** Days before the event, 0 for none. */
  value: number;
  onChange: (days: number) => void;
  /** The group's leader turned event reminders off; the choice is kept for when they're back on. */
  groupOff: boolean;
}

export function ReminderField({ value, onChange, groupOff }: ReminderFieldProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor="reminder_days_before" className="text-lg">Send a reminder</Label>
      <Select
        items={REMINDER_ITEMS}
        value={String(value)}
        onValueChange={(next) => onChange(Number(next ?? value))}
      >
        <SelectTrigger
          id="reminder_days_before"
          className="w-full text-lg"
          aria-describedby={groupOff ? "reminder_days_before-off" : undefined}
        >
          <SelectValue>{reminderLabel(value)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {REMINDER_ITEMS.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {groupOff && (
        <p id="reminder_days_before-off" className="text-base text-muted-foreground">
          Event reminders are off for this group.
        </p>
      )}
    </div>
  );
}
