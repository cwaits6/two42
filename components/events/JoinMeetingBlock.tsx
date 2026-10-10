"use client";

import { useEffect, useState } from "react";
import { Video, Copy, Check, ArrowRight, Play } from "lucide-react";
import {
  getJoinState,
  msUntilNextJoinTransition,
  joinButtonLabel,
  type JoinState,
} from "@/lib/meetings";

interface JoinMeetingBlockProps {
  meetingUrl: string;
  meetingId: string | null;
  passcode: string | null;
  /** Occurrence start/end (ISO) — not the series anchor's original date. */
  startTime: string;
  endTime: string | null;
  leadMinutes: number;
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
    <div
      className="flex flex-1 min-w-0 items-center gap-2 rounded-[10px] py-2 pl-3 pr-2"
      style={{ background: "rgba(0,0,0,0.20)", border: "1px solid rgba(255,255,255,0.22)" }}
    >
      <div className="flex-1 min-w-0">
        <div className="font-sans text-lg font-bold uppercase tracking-[1.2px] text-white/55">
          {label}
        </div>
        <div className="font-mono text-xl text-white mt-0.5 tracking-[0.4px] whitespace-nowrap overflow-hidden text-ellipsis">
          {value}
        </div>
      </div>
      <button
        type="button"
        onClick={handleCopy}
        aria-label={`Copy ${label.toLowerCase()}`}
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-white/20"
        style={{ background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.22)" }}
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-white" />
        ) : (
          <Copy className="h-3.5 w-3.5 text-white/78" />
        )}
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
  recordingsHref,
}: JoinMeetingBlockProps) {
  const [state, setState] = useState<JoinState>(() =>
    getJoinState(new Date(), startTime, endTime, leadMinutes)
  );

  // Re-evaluate exactly when the state next changes (upcoming → live → ended).
  useEffect(() => {
    setState(getJoinState(new Date(), startTime, endTime, leadMinutes));
    const ms = msUntilNextJoinTransition(new Date(), startTime, endTime, leadMinutes);
    if (ms === null) return;
    const timer = setTimeout(
      () => setState(getJoinState(new Date(), startTime, endTime, leadMinutes)),
      ms + 250
    );
    return () => clearTimeout(timer);
  }, [state, startTime, endTime, leadMinutes]);

  const provider = providerName(meetingUrl);
  const buttonLabel = joinButtonLabel(meetingUrl);

  const opensAt = new Date(
    new Date(startTime).getTime() - leadMinutes * 60 * 1000
  ).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });

  const creds = (meetingId || passcode) && (
    <div className="flex gap-2 mt-3">
      {meetingId && <CopyField label="Meeting ID" value={meetingId} />}
      {passcode && <CopyField label="Passcode" value={passcode} />}
    </div>
  );

  const outlineButtonClass =
    "flex w-full items-center justify-center gap-2 mt-3 rounded-xl py-3 font-sans text-[15px] font-semibold text-white transition-colors hover:bg-white/20";
  const outlineButtonStyle = {
    background: "rgba(255,255,255,0.10)",
    border: "1px solid rgba(255,255,255,0.4)",
  };

  const statusRowClass =
    "flex items-center gap-2 font-sans text-lg font-bold uppercase tracking-[1.6px]";

  // ── ENDED ──────────────────────────────────────────────
  if (state === "ended") {
    return (
      <div
        className="rounded-[14px] p-4"
        style={{ background: "rgba(255,255,255,0.09)", border: "1px solid rgba(255,255,255,0.22)" }}
      >
        <div className={statusRowClass}>
          <span className="h-2 w-2 rounded-full bg-white/55" />
          <span className="text-white/55">This event has ended</span>
        </div>
        {recordingsHref && (
          <>
            <p className="font-sans text-sm text-white/78 leading-relaxed mt-2.5">
              Missed it? The recording is posted to Lectures.
            </p>
            <a href={recordingsHref} className={outlineButtonClass} style={outlineButtonStyle}>
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
      <div
        className="rounded-[14px] p-4"
        style={{ background: "rgba(255,255,255,0.09)", border: "1px solid rgba(255,255,255,0.22)" }}
      >
        <div className={statusRowClass}>
          <Video className="h-4 w-4" style={{ color: "var(--color-brand-accent)" }} />
          <span className="text-white">
            Join online{provider ? ` · ${provider}` : ""}
          </span>
        </div>
        <p className="font-sans text-base text-white/78 leading-relaxed mt-2">
          One-tap join opens at <strong className="text-white">{opensAt}</strong>,{" "}
          {leadMinutes} minutes before start.
        </p>
        <a
          href={meetingUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={outlineButtonClass}
          style={outlineButtonStyle}
        >
          <Video className="h-4 w-4" /> {buttonLabel}
        </a>
      </div>
    );
  }

  // ── LIVE ───────────────────────────────────────────────
  return (
    <div
      className="rounded-[14px] p-4"
      style={{ background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.22)" }}
    >
      <div className={statusRowClass}>
        <span
          className="inline-block h-[9px] w-[9px] rounded-full"
          style={{ background: "var(--color-brand-accent)" }}
        />
        <span style={{ color: "var(--color-brand-accent)" }}>Live now</span>
      </div>
      <a
        href={meetingUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex w-full items-center justify-center gap-2.5 mt-3 rounded-xl py-[15px] font-sans text-base font-bold transition-opacity hover:opacity-90"
        style={{
          background: "var(--color-brand-accent)",
          color: "var(--foreground)",
          boxShadow: "0 8px 22px rgba(0,0,0,0.22)",
        }}
      >
        <Video className="h-5 w-5" /> {buttonLabel}
        <ArrowRight className="h-[18px] w-[18px]" />
      </a>
      {creds}
    </div>
  );
}
