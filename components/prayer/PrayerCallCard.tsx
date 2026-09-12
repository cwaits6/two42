"use client";

import { useState } from "react";
import { Check, Pencil, Phone, Plus } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import {
  Combobox,
  ComboboxInput,
  ComboboxPopup,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
} from "@/components/ui/combobox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { sessionLabel, telHref, WEEKDAY_LABELS } from "@/lib/prayer";
import { savePrayerCallSessions, type SessionDraft } from "@/lib/prayerCalls";
import type { MemberOption } from "@/components/giving/FundForm";
import type { PrayerCallSession } from "@/lib/types";

interface Draft {
  id: string | null;
  /** stringified weekday for the select */
  weekday: string;
  /** "HH:MM" */
  start_time: string;
  end_time: string;
  leader_id: string;
  dial_in: string;
  pin: string;
  join_url: string;
  event_id: string | null;
}

const NONE = "none";

const WEEKDAY_OPTIONS = WEEKDAY_LABELS.map((label, w) => ({
  value: String(w),
  label,
}));

const toDraft = (s: PrayerCallSession): Draft => ({
  id: s.id,
  weekday: String(s.weekday),
  start_time: s.start_time.slice(0, 5),
  end_time: s.end_time?.slice(0, 5) ?? "",
  leader_id: s.leader_id ?? NONE,
  dial_in: s.dial_in ?? "",
  pin: s.pin ?? "",
  join_url: s.join_url ?? "",
  event_id: s.event_id,
});

const EMPTY_DRAFT: Draft = {
  id: null,
  weekday: "3",
  start_time: "",
  end_time: "",
  leader_id: NONE,
  dial_in: "",
  pin: "",
  join_url: "",
  event_id: null,
};

const inputClass =
  "w-full rounded-lg border border-white/25 bg-white/10 px-2.5 py-2 text-sm text-background outline-none placeholder:text-background/40 focus:border-white/50";

export function PrayerCallCard({
  initialSessions,
  isAdmin,
  members,
  prayerCalendarId,
  orgId,
}: {
  initialSessions: PrayerCallSession[];
  isAdmin: boolean;
  members: MemberOption[];
  prayerCalendarId: string | null;
  /** Resolved server-side from the caller's own profile, never derived here:
   *  the browser client cannot read a cookie-bound org anchor. */
  orgId: string;
}) {
  const [sessions, setSessions] = useState(initialSessions);
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [saving, setSaving] = useState(false);
  const editing = drafts !== null;

  if (sessions.length === 0 && !isAdmin) return null;

  const memberName = (id: string | null) =>
    id ? members.find((m) => m.id === id)?.name ?? null : null;
  const memberLabel = (id: string) =>
    id === NONE ? "No leader" : members.find((m) => m.id === id)?.name ?? "";
  const leaderIds = [NONE, ...members.map((m) => m.id)];

  const startEditing = () =>
    setDrafts(sessions.length > 0 ? sessions.map(toDraft) : [{ ...EMPTY_DRAFT }]);

  const setField = (i: number, key: keyof Draft, value: string) =>
    setDrafts((d) =>
      d ? d.map((x, j) => (j === i ? { ...x, [key]: value } : x)) : d
    );

  const save = async () => {
    if (!drafts) return;
    const kept = drafts.filter(
      (d) => d.start_time || d.dial_in.trim() || d.join_url.trim()
    );
    if (kept.some((d) => !d.start_time)) {
      toast.error("Each session needs a start time.");
      return;
    }
    setSaving(true);
    const supabase = createClient();
    const keptIds = new Set(kept.map((d) => d.id).filter(Boolean));
    const removed = sessions.filter((s) => !keptIds.has(s.id));

    const sessionDrafts: SessionDraft[] = kept.map((d, i) => ({
      id: d.id,
      weekday: Number(d.weekday),
      start_time: d.start_time,
      end_time: d.end_time || null,
      leader_id: d.leader_id === NONE ? null : d.leader_id,
      dial_in: d.dial_in.trim() || null,
      pin: d.pin.trim() || null,
      join_url: d.join_url.trim() || null,
      event_id: d.event_id,
      display_order: i,
    }));

    const errMsg = await savePrayerCallSessions(
      supabase,
      orgId,
      sessionDrafts,
      removed,
      prayerCalendarId
    );
    const { data: fresh, error: fetchError } = await supabase
      .from("prayer_call_sessions")
      .select("*")
      .order("display_order")
      .order("created_at");
    setSaving(false);

    if (errMsg || fetchError) {
      // Carry the ids of rows that did get written back into the drafts, so
      // retrying updates them instead of inserting duplicates.
      setDrafts((cur) =>
        cur
          ? cur.map((d) => {
              const i = kept.indexOf(d);
              if (i === -1) return d;
              const saved = sessionDrafts[i];
              return { ...d, id: saved.id, event_id: saved.event_id };
            })
          : cur
      );
      toast.error(errMsg ?? "Couldn't save the call details. Please try again.");
      return;
    }
    setSessions((fresh ?? []) as PrayerCallSession[]);
    setDrafts(null);
  };

  const joinUrl = sessions.find((s) => s.join_url)?.join_url ?? null;
  const dialSession = sessions.find((s) => s.dial_in) ?? null;

  return (
    <div className="overflow-hidden rounded-2xl bg-foreground p-6 text-background">
      <div className="flex items-start justify-between gap-3">
        <div className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-brand-accent">
          <span aria-hidden="true" className="h-px w-5 bg-brand-accent" />
          Weekly prayer
        </div>
        {isAdmin && (
          <button
            type="button"
            onClick={() => (editing ? save() : startEditing())}
            disabled={saving}
            className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition-colors disabled:opacity-50 ${
              editing
                ? "bg-brand-accent text-foreground"
                : "bg-white/10 text-background hover:bg-white/20"
            }`}
          >
            {editing ? (
              <>
                <Check className="h-3 w-3" aria-hidden="true" />
                {saving ? "Saving…" : "Save"}
              </>
            ) : (
              <>
                <Pencil className="h-3 w-3" aria-hidden="true" />
                Edit
              </>
            )}
          </button>
        )}
      </div>

      <h2 className="text-2xl font-semibold text-background">The prayer call</h2>
      <p className="mt-2 mb-4 text-sm leading-relaxed text-background/80">
        We gather by phone to pray through the wall. Everyone is welcome to
        join. Each call is also on the group calendar.
      </p>

      {editing ? (
        <div className="flex flex-col gap-3">
          {drafts.map((d, i) => (
            <div
              key={d.id ?? `new-${i}`}
              className="flex flex-col gap-3 rounded-xl border border-white/20 p-3.5"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-widest text-background/60">
                  Session {i + 1}
                </span>
                {drafts.length > 1 && (
                  <button
                    type="button"
                    onClick={() =>
                      setDrafts((cur) =>
                        cur ? cur.filter((_, j) => j !== i) : cur
                      )
                    }
                    className="text-xs font-semibold text-background/60 hover:text-background"
                  >
                    Remove
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <label className="col-span-2 block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-background/85">
                    Day
                  </span>
                  <Select
                    items={WEEKDAY_OPTIONS}
                    value={d.weekday}
                    onValueChange={(v) => setField(i, "weekday", v ?? d.weekday)}
                  >
                    <SelectTrigger className="w-full rounded-lg border-white/25 bg-white/10 text-background focus-visible:border-white/50">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {WEEKDAY_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-background/85">
                    Starts
                  </span>
                  <input
                    type="time"
                    value={d.start_time}
                    onChange={(e) => setField(i, "start_time", e.target.value)}
                    className={inputClass}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-background/85">
                    Ends (optional)
                  </span>
                  <input
                    type="time"
                    value={d.end_time}
                    onChange={(e) => setField(i, "end_time", e.target.value)}
                    className={inputClass}
                  />
                </label>
                <div className="col-span-2">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-background/85">
                    Call leader
                  </span>
                  <Combobox
                    items={leaderIds}
                    itemToStringLabel={memberLabel}
                    value={d.leader_id}
                    onValueChange={(v) => setField(i, "leader_id", v ?? NONE)}
                  >
                    <ComboboxInput
                      placeholder="Search members…"
                      className={inputClass}
                    />
                    <ComboboxPopup>
                      <ComboboxEmpty />
                      <ComboboxList>
                        {(id: string) => (
                          <ComboboxItem key={id} value={id}>
                            {memberLabel(id)}
                          </ComboboxItem>
                        )}
                      </ComboboxList>
                    </ComboboxPopup>
                  </Combobox>
                </div>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-background/85">
                    Dial in
                  </span>
                  <input
                    value={d.dial_in}
                    onChange={(e) => setField(i, "dial_in", e.target.value)}
                    placeholder="(770) 555-0170"
                    className={inputClass}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-background/85">
                    PIN
                  </span>
                  <input
                    value={d.pin}
                    onChange={(e) => setField(i, "pin", e.target.value)}
                    placeholder="4412#"
                    className={inputClass}
                  />
                </label>
                <label className="col-span-2 block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-background/85">
                    Join link (optional)
                  </span>
                  <input
                    value={d.join_url}
                    onChange={(e) => setField(i, "join_url", e.target.value)}
                    placeholder="https://…"
                    className={inputClass}
                  />
                </label>
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              setDrafts((cur) => (cur ? [...cur, { ...EMPTY_DRAFT }] : cur))
            }
            className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-white/30 py-2.5 text-sm font-semibold text-background/80 hover:text-background"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add another session
          </button>
        </div>
      ) : sessions.length > 0 ? (
        <>
          <div className="flex flex-col gap-2.5">
            {sessions.map((s) => {
              const leaderName = memberName(s.leader_id);
              return (
                <div
                  key={s.id}
                  className="flex items-center gap-3.5 rounded-xl border border-white/15 px-4 py-3"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/10">
                    <Phone
                      className="h-4 w-4 text-brand-accent"
                      aria-hidden="true"
                    />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-base font-bold">{sessionLabel(s)}</div>
                    {leaderName && (
                      <div className="mt-0.5 text-sm text-background/85">
                        Led by {leaderName}
                      </div>
                    )}
                    {(s.dial_in || s.pin) && (
                      <div className="mt-0.5 font-mono text-sm text-background/85">
                        {s.dial_in && (
                          <a
                            href={telHref(s.dial_in, s.pin)}
                            className="inline-block py-1 hover:underline"
                          >
                            {s.dial_in}
                          </a>
                        )}
                        {s.dial_in && s.pin && " · "}
                        {s.pin && `PIN ${s.pin}`}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {joinUrl ? (
            <a
              href={joinUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 block rounded-lg bg-brand-accent px-4 py-3 text-center text-sm font-bold text-foreground"
            >
              Join the call
            </a>
          ) : dialSession?.dial_in ? (
            // tel: with DTMF pauses enters the PIN automatically on a phone;
            // on desktop the link is harmless, so it shows everywhere.
            <a
              href={telHref(dialSession.dial_in, dialSession.pin)}
              className="mt-4 block rounded-lg bg-brand-accent px-4 py-3 text-center text-sm font-bold text-foreground"
            >
              Call in
            </a>
          ) : null}
        </>
      ) : (
        <button
          type="button"
          onClick={startEditing}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-white/30 py-3 text-sm font-semibold text-background/80 hover:text-background"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add call details
        </button>
      )}
    </div>
  );
}
