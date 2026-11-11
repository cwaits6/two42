"use client";

import { useState } from "react";
import { Video, Copy, Check, Play } from "lucide-react";
import { useJoinState } from "@/components/events/useJoinState";
import { joinButtonLabel } from "@/lib/meetings";
import { formatEventTime } from "@/lib/time/zone";

interface JoinMeetingBlockProps {
  /** Null when the leader gave only an ID and passcode: no button, just the details. */
  meetingUrl: string | null;
  meetingId: string | null;
  passcode: string | null;
  /** Occurrence start/end (ISO) — not the series anchor's original date. */
  startTime: string;
  endTime: string | null;
  leadMinutes: number;
  /** The org's zone, resolved by the server; the "opens at" time is its wall clock. */
  timeZone: string;
  /** Where "Watch the recording" points after the event ends; omit to hide. */
  recordingsHref?: string | null;
}

function providerName(meetingUrl: string): string | null {
  const label = joinButtonLabel(meetingUrl);
  return label.startsWith("Join on ") ? label.slice("Join on ".length) : null;
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable — nothing useful to do
    }
  };

  return (
    <div className="flex flex-1 min-w-0 items-center gap-2 rounded-[10px] border border-primary-foreground/25 bg-foreground/20 py-2 pl-3 pr-2">
      <div className="flex-1 min-w-0">
        <div className="font-sans text-base font-bold text-primary-foreground">{label}</div>
        <div className="font-mono text-xl text-primary-foreground mt-0.5 tracking-[0.4px] whitespace-nowrap overflow-hidden text-ellipsis">
          {value}
        </div>
      </div>
      <button
        type="button"
        onClick={handleCopy}
        aria-label={`Copy ${label.toLowerCase()}`}
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-primary-foreground/25 bg-foreground/10 text-primary-foreground transition-colors hover:bg-foreground/30"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

export function JoinMeetingBlock({
  meetingUrl,
  meetingId,
  passcode,
  startTime,
  endTime,
  leadMinutes,
  timeZone,
  recordingsHref,
}: JoinMeetingBlockProps) {
  const state = useJoinState(startTime, endTime, leadMinutes);

  const provider = meetingUrl ? providerName(meetingUrl) : null;
  const buttonLabel = meetingUrl ? joinButtonLabel(meetingUrl) : null;

  const opensAt = formatEventTime(
    new Date(new Date(startTime).getTime() - leadMinutes * 60 * 1000).toISOString(),
    timeZone
  );

  const whatToEnter = passcode ? "the meeting ID and passcode" : "the meeting ID";

  const creds = (meetingId || passcode) && (
    <div className="flex gap-2 mt-3">
      {meetingId && <CopyField label="Meeting ID" value={meetingId} />}
      {passcode && <CopyField label="Passcode" value={passcode} />}
    </div>
  );

  // Every fill darkens the panel it sits on, so white text never drops below
  // the 4.5:1 the panel's own color is held to.
  const blockClass = "rounded-[14px] border border-primary-foreground/25 p-4";
  const outlineButtonClass =
    "flex w-full items-center justify-center gap-2 mt-3 rounded-xl border border-primary-foreground/40 bg-foreground/10 py-3 font-sans text-base font-semibold text-primary-foreground transition-colors hover:bg-foreground/25";

  const statusRowClass = "flex items-center gap-2 font-sans text-lg font-bold";

  // ── ENDED ──────────────────────────────────────────────
  if (state === "ended") {
    return (
      <div className={`${blockClass} bg-foreground/10`}>
        <div className={statusRowClass}>
          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-primary-foreground/80" />
          <span className="text-primary-foreground">This event has ended</span>
        </div>
        {recordingsHref && (
          <>
            <p className="font-sans text-base text-primary-foreground leading-relaxed mt-2.5">
              Missed it? The recording is posted to Lessons.
            </p>
            <a href={recordingsHref} className={outlineButtonClass}>
              <Play className="h-4 w-4" /> Watch the recording
            </a>
          </>
        )}
      </div>
    );
  }

  // ── UPCOMING ───────────────────────────────────────────
  if (state === "upcoming") {
    return (
      <div className={`${blockClass} bg-foreground/10`}>
        <div className={statusRowClass}>
          <Video className="h-4 w-4 text-brand-accent" />
          <span className="text-primary-foreground">
            Join online{provider ? ` · ${provider}` : ""}
          </span>
        </div>
        {meetingUrl ? (
          <>
            <p className="font-sans text-base text-primary-foreground leading-relaxed mt-2">
              One-tap join opens at <strong>{opensAt}</strong>,{" "}
              {leadMinutes} minutes before start.
            </p>
            <a
              href={meetingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={outlineButtonClass}
            >
              <Video className="h-4 w-4" /> {buttonLabel}
            </a>
          </>
        ) : (
          <>
            <p className="font-sans text-base text-primary-foreground leading-relaxed mt-2">
              At <strong>{opensAt}</strong>, open your meeting app and
              enter {whatToEnter}.
            </p>
            {creds}
          </>
        )}
      </div>
    );
  }

  // ── LIVE ───────────────────────────────────────────────
  return (
    <div className={`${blockClass} bg-brand-primary-hover`}>
      <div className={statusRowClass}>
        <span aria-hidden="true" className="inline-block h-[9px] w-[9px] rounded-full bg-brand-accent" />
        <span className="text-primary-foreground">Live now</span>
      </div>
      {meetingUrl ? (
        <a
          href={meetingUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex w-full items-center justify-center gap-2.5 mt-3 rounded-xl bg-brand-accent py-[15px] font-sans text-base font-bold text-foreground shadow-lg transition-opacity hover:opacity-85"
        >
          <Video className="h-5 w-5" /> {buttonLabel}
        </a>
      ) : (
        <p className="font-sans text-base text-primary-foreground leading-relaxed mt-2">
          Open your meeting app and enter {whatToEnter}.
        </p>
      )}
      {creds}
    </div>
  );
}
