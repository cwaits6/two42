"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { CalendarSetting } from "./detailsChanges";

const ROWS: { key: CalendarSetting; label: string; description: string }[] = [
  {
    key: "calendar_meeting_details",
    label: "Join details",
    description: "The meeting link, ID and passcode of online events.",
  },
  {
    key: "calendar_event_notes",
    label: "Notes",
    description: "Each event's description.",
  },
  {
    key: "calendar_event_location",
    label: "Location",
    description: "Where each event is.",
  },
];

export function CalendarSubscriptionCard({
  values,
  onChange,
}: {
  values: Record<CalendarSetting, boolean>;
  onChange: (key: CalendarSetting, next: boolean) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl font-bold text-foreground">Calendar subscriptions</CardTitle>
        <CardDescription className="text-base">
          What members&apos; calendar apps get when they subscribe to this group&apos;s calendar.
          Anything turned off is replaced by a link to the event page, where signed-in members see
          everything. An event can choose differently when it&apos;s added or edited.
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
              onCheckedChange={(next) => onChange(row.key, next)}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
