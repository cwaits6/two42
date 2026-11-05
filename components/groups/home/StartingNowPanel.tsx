"use client";

import Link from "next/link";
import { Play, Video } from "lucide-react";
import { useJoinState } from "@/components/events/useJoinState";
import { joinButtonLabel } from "@/lib/meetings";
import type { StartingNowEvent } from "@/lib/groups/groupHome";

const LIGHT_BUTTON =
  "flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-card px-4 py-3 font-sans text-base font-semibold text-brand-primary-text transition-colors hover:bg-brand-warm";

/** Home's one big panel: Clay, from the join window opening until the ended grace period runs out. */
export function StartingNowPanel({
  event,
  recordingsHref,
}: {
  event: StartingNowEvent;
  /** Where "Watch the recording" points after the event ends; null drops the panel once it has ended. */
  recordingsHref: string | null;
}) {
  const { meetingUrl, meetingId, passcode, startTime, endTime, leadMinutes } = event;
  const ended = useJoinState(startTime, endTime, leadMinutes) === "ended";
  // An event can end while Home is open; with no recording to offer, the panel goes with it.
  if (ended && !recordingsHref) return null;
  const details = [meetingId && `Meeting ID ${meetingId}`, passcode && `Passcode ${passcode}`]
    .filter(Boolean)
    .join(" · ");
  const whatToEnter = passcode ? "the meeting ID and passcode" : "the meeting ID";

  return (
    <section className="rounded-2xl bg-brand-primary p-6 text-white">
      <p className="flex items-center gap-2.5 font-sans text-base font-semibold">
        <span aria-hidden="true" className="h-2 w-2 rounded-full bg-brand-accent" />
        {ended ? "This event has ended" : "Starting now"}
      </p>
      <h2 className="mt-1 font-serif text-3xl font-medium leading-tight tracking-tight">
        <Link href={event.href} className="inline-flex min-h-11 items-center hover:underline">
          {event.title}
        </Link>
      </h2>
      {ended && recordingsHref ? (
        <>
          <p className="mt-2 font-sans text-base">Missed it? The recording is posted to Lessons.</p>
          <Link href={recordingsHref} className={`mt-3 ${LIGHT_BUTTON}`}>
            <Play className="h-5 w-5" aria-hidden="true" />
            Watch the recording
          </Link>
        </>
      ) : (
        <>
          {meetingUrl ? (
            <a
              href={meetingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`mt-3 ${LIGHT_BUTTON}`}
            >
              <Video className="h-5 w-5" aria-hidden="true" />
              {joinButtonLabel(meetingUrl)}
            </a>
          ) : (
            <p className="mt-2 font-sans text-base">Open your meeting app and enter {whatToEnter}.</p>
          )}
          {details && <p className="mt-3 font-sans text-base">{details}</p>}
        </>
      )}
    </section>
  );
}
