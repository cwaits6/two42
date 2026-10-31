"use client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SHARE_ALL, sharingSummary, type CalendarSharing } from "@/lib/calendar/sharing";

const ROWS: { key: keyof CalendarSharing; label: string; description: string }[] = [
  { key: "joinDetails", label: "Join details", description: "The meeting link, ID and passcode." },
  { key: "notes", label: "Notes", description: "The description." },
  { key: "location", label: "Location", description: "Where the event is." },
];

interface CalendarSharingFieldsProps {
  /** The group's settings; null when they couldn't be loaded. */
  groupSharing: CalendarSharing | null;
  /** This event's own choice, or null to follow the group. */
  own: CalendarSharing | null;
  onChange: (own: CalendarSharing | null) => void;
  isRecurring: boolean;
}

export function CalendarSharingFields({
  groupSharing,
  own,
  onChange,
  isRecurring,
}: CalendarSharingFieldsProps) {
  return (
    <div className="space-y-4 rounded-2xl border border-border bg-background p-4">
      <div>
        <h2 className="font-sans text-lg font-medium text-foreground">Calendar subscriptions</h2>
        <p className="text-base text-muted-foreground">
          What members&apos; calendar apps get for {isRecurring ? "every date of this event" : "this event"}.
          Anything left out is replaced by a link to the event page.
        </p>
      </div>

      {own === null ? (
        <div className="space-y-3">
          {/* Plain text, not a link: leaving mid-form would lose what was typed. */}
          <p className="text-base text-foreground">
            Using the group&apos;s settings{groupSharing ? `: ${sharingSummary(groupSharing)}` : "."}
          </p>
          <p className="text-base text-muted-foreground">
            The group&apos;s settings are under Group settings → About.
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => onChange(groupSharing ?? SHARE_ALL)}
          >
            Choose for this event
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="divide-y divide-border">
            {ROWS.map((row) => (
              <div
                key={row.key}
                className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <Label htmlFor={`share-${row.key}`} className="text-lg">
                    {row.label}
                  </Label>
                  <p id={`share-${row.key}-help`} className="text-base text-muted-foreground">
                    {row.description}
                  </p>
                </div>
                <Switch
                  id={`share-${row.key}`}
                  aria-describedby={`share-${row.key}-help`}
                  className="mt-1 shrink-0"
                  checked={own[row.key]}
                  onCheckedChange={(next) => onChange({ ...own, [row.key]: next })}
                />
              </div>
            ))}
          </div>
          <Button type="button" variant="outline" onClick={() => onChange(null)}>
            Use the group&apos;s settings
          </Button>
        </div>
      )}
    </div>
  );
}
