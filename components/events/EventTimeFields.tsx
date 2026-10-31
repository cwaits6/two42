"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError, invalidFieldProps } from "@/components/ui/field-error";
import { zoneName } from "@/components/events/eventTimes";

interface EventTimeFieldsProps {
  startTime: string;
  endTime: string;
  onStartTimeChange: (value: string) => void;
  onEndTimeChange: (value: string) => void;
  /** The org's zone: the times are its wall clock, so the form names it. */
  timeZone: string;
  endError?: string;
}

const ZONE_NOTE_ID = "event-time-zone";

/** Start and end, with the org's time zone named beside them. Inputs are named start_time and end_time. */
export function EventTimeFields({
  startTime,
  endTime,
  onStartTimeChange,
  onEndTimeChange,
  timeZone,
  endError,
}: EventTimeFieldsProps) {
  const endInvalid = invalidFieldProps("end_time", endError);
  return (
    <div className="space-y-2">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="start_time" className="text-lg">Start time</Label>
          <Input
            id="start_time"
            name="start_time"
            type="datetime-local"
            required
            className="text-lg"
            aria-describedby={ZONE_NOTE_ID}
            value={startTime}
            onChange={(e) => onStartTimeChange(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="end_time" className="text-lg">End time</Label>
          <Input
            id="end_time"
            name="end_time"
            type="datetime-local"
            className="text-lg"
            value={endTime}
            onChange={(e) => onEndTimeChange(e.target.value)}
            {...endInvalid}
            aria-describedby={[ZONE_NOTE_ID, endInvalid["aria-describedby"]].filter(Boolean).join(" ")}
          />
          <FieldError fieldId="end_time" message={endError} />
        </div>
      </div>
      <p id={ZONE_NOTE_ID} className="text-base text-muted-foreground">
        Times are in {zoneName(timeZone)}.
      </p>
    </div>
  );
}
