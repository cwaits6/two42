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
  compact?: boolean;
  instance?: string | number;
}
const detailButtonStyle = [
  "--btn-background:var(--card)",
  "--btn-hover-background:var(--color-brand-warm)",
  "--btn-hover-border:var(--color-brand-primary)",
  "--btn-border:var(--color-brand-bg-muted)",
  "--btn-border-width:1px",
  "--btn-border-radius:0.75rem",
  "--btn-padding-x:0.95em",
  "--btn-padding-y:0.52em",
  "--btn-text:var(--muted-foreground)",
  "--btn-hover-text:var(--color-brand-primary)",
  "--btn-font-weight:600",
  "--font:var(--font-sans), sans-serif",
  "--base-font-size-l:16px",
  "--base-font-size-m:16px",
  "--base-font-size-s:16px",
  "--accent-color:var(--color-brand-primary)",
  "--list-background:var(--card)",
  "--list-hover-background:var(--color-brand-warm)",
  "--list-text:var(--foreground)",
  "--list-hover-text:var(--color-brand-primary)",
  "--list-border:var(--color-brand-bg-muted)",
  "--list-border-radius:1rem",
  "--list-padding:0.8em 1em",
  "--buttonslist-gap:0.75rem",
].join(";");

const compactButtonStyle = [
  "--btn-background:var(--card)",
  "--btn-hover-background:var(--background)",
  "--btn-hover-border:var(--border)",
  "--btn-border:var(--border)",
  "--btn-border-width:1px",
  "--btn-border-radius:0.75rem",
  "--btn-padding-x:0.9em",
  "--btn-padding-y:0.55em",
  "--btn-text:var(--foreground)",
  "--btn-hover-text:var(--color-brand-primary)",
  "--btn-font-weight:600",
  "--font:var(--font-sans), sans-serif",
  "--base-font-size-l:16px",
  "--base-font-size-m:16px",
  "--base-font-size-s:16px",
  "--accent-color:var(--color-brand-primary)",
  "--list-background:var(--card)",
  "--list-hover-background:var(--color-brand-warm)",
  "--list-text:var(--foreground)",
  "--list-hover-text:var(--color-brand-primary)",
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
  compact,
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
        className={compact ? "h-8 w-24 rounded-md border border-input bg-background" : "h-10 w-40 rounded-md border border-input bg-background"}
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
      size={compact ? "3" : "5"}
      styleLight={compact ? compactButtonStyle : detailButtonStyle}
      styleDark={compact ? compactButtonStyle : detailButtonStyle}
      hideBranding
    />
  );
}
