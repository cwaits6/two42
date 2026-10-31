"use client";

import { useSyncExternalStore } from "react";
import { AddToCalendarButton as AtcButton } from "add-to-calendar-button-react";
import { isoToLocalInput } from "@/lib/time/zone";

interface AddToCalendarButtonProps {
  eventTitle: string;
  startTime: string;
  endTime?: string | null;
  location?: string | null;
  description?: string | null;
  /** The org's zone, resolved by the server; the wall-clock fields and the TZID handed to the calendar apps. */
  timeZone: string;
  instance?: string | number;
}
// Matches the outline Button beside it: same ground, border, radius and a
// 48px height, so the two read as one row of actions.
const buttonStyle = [
  "--btn-background:var(--background)",
  "--btn-hover-background:var(--muted)",
  "--btn-hover-border:var(--border)",
  "--btn-border:var(--border)",
  "--btn-border-width:1px",
  "--btn-border-radius:0.5rem",
  "--btn-shadow:none",
  "--btn-hover-shadow:none",
  "--btn-padding-x:1em",
  "--btn-padding-y:0.8em",
  "--btn-text:var(--foreground)",
  "--btn-hover-text:var(--foreground)",
  "--btn-font-weight:500",
  "--font:var(--font-sans), sans-serif",
  "--base-font-size-l:16px",
  "--base-font-size-m:16px",
  "--base-font-size-s:16px",
  "--accent-color:var(--color-brand-primary)",
  "--list-background:var(--card)",
  "--list-hover-background:var(--color-brand-warm)",
  "--list-text:var(--foreground)",
  "--list-hover-text:var(--color-brand-primary-text)",
  "--list-border:var(--border)",
  "--list-border-radius:1rem",
  "--list-padding:0.8em 1em",
].join(";");

/** The wall-clock date and time in `zone`, in the `YYYY-MM-DD` / `HH:mm` shapes the button takes. */
function wallClock(iso: string, zone: string): { date: string; time: string } {
  const [date, time] = isoToLocalInput(iso, zone).split("T");
  return { date, time };
}

export function AddToCalendarButton({
  eventTitle,
  startTime,
  endTime,
  location,
  description,
  timeZone,
  instance,
}: AddToCalendarButtonProps) {
  const isMounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const startDate = new Date(startTime);
  const parsedEndTime = endTime ? new Date(endTime) : null;
  const effectiveEndTime =
    parsedEndTime && parsedEndTime.getTime() > startDate.getTime()
      ? parsedEndTime.toISOString()
      : new Date(startDate.getTime() + 60 * 60 * 1000).toISOString();

  if (!isMounted) {
    return (
      <div
        aria-hidden="true"
        className="h-12 w-44 rounded-lg border border-border bg-background"
      />
    );
  }

  const start = wallClock(startTime, timeZone);
  const end = wallClock(effectiveEndTime, timeZone);

  return (
    <AtcButton
      instance={instance}
      name={eventTitle}
      startDate={start.date}
      startTime={start.time}
      endDate={end.date}
      endTime={end.time}
      timeZone={timeZone}
      location={location || undefined}
      description={description ?? undefined}
      options={["Apple", "Google", "iCal", "Outlook.com", "Microsoft365"]}
      buttonStyle="default"
      lightMode="light"
      label="Add to calendar"
      size="5"
      styleLight={buttonStyle}
      styleDark={buttonStyle}
      hideBranding
    />
  );
}
