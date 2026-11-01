"use client";

import { useEffect, useState } from "react";
import { Pencil, Phone, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxInput,
  ComboboxPopup,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
} from "@/components/ui/combobox";
import { FieldError, invalidFieldProps } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { zoneName } from "@/components/events/eventTimes";
import { failureMessage } from "@/lib/errorCopy";
import { sessionLabel, telHref, toCallSession, WEEKDAY_LABELS } from "@/lib/prayer";
import { savePrayerCallSessions, type SessionDraft } from "@/lib/prayerCalls";
import type { MemberOption } from "@/components/giving/FundForm";
import type { PrayerGroup } from "@/components/prayer/PrayerBoard";
import type { PrayerCallSession } from "@/lib/types";

/** Everything the card shows: the weekly call times and the standing time and link from group settings. */
export interface PrayerCall {
  sessions: PrayerCallSession[];
  url: string | null;
  time: string | null;
}

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

interface Editing {
  drafts: Draft[];
  url: string;
  time: string;
}

const NONE = "none";

const WEEKDAY_OPTIONS = WEEKDAY_LABELS.map((label, w) => ({
  value: String(w),
  label,
}));

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

const toDraft = (s: PrayerCallSession): Draft => ({
  id: s.id,
  weekday: WEEKDAY_LABELS[s.weekday] ? String(s.weekday) : EMPTY_DRAFT.weekday,
  start_time: s.start_time.slice(0, 5),
  end_time: s.end_time?.slice(0, 5) ?? "",
  leader_id: s.leader_id ?? NONE,
  dial_in: s.dial_in ?? "",
  pin: s.pin ?? "",
  join_url: s.join_url ?? "",
  event_id: s.event_id,
});

const isHttpsOrEmpty = (url: string) => !url || url.startsWith("https://");
const LINK_ERROR = "Enter a link that starts with https://";

/** The ids of the fields that fail validation, with what to enter; empty drafts are dropped first. */
function validate(editing: Editing, kept: Draft[]): Record<string, string> {
  const errors: Record<string, string> = {};
  editing.drafts.forEach((d, i) => {
    if (!kept.includes(d)) return;
    if (!d.start_time) errors[`call-${i}-start`] = "Enter a start time.";
    if (!isHttpsOrEmpty(d.join_url.trim())) errors[`call-${i}-join`] = LINK_ERROR;
  });
  if (!isHttpsOrEmpty(editing.url.trim())) errors["call-link"] = LINK_ERROR;
  return errors;
}

export function PrayerCallCard({
  initial,
  group,
  members,
  orgId,
  userId,
  timeZone,
}: {
  initial: PrayerCall;
  /** The verified active group; the sessions and their events belong to it. */
  group: PrayerGroup;
  members: MemberOption[];
  /** Resolved server-side from the caller's own profile, never derived here:
   *  the browser client cannot read a cookie-bound org anchor. */
  orgId: string;
  userId: string;
  /** The church's zone; the call times are its wall clock. */
  timeZone: string;
}) {
  const [call, setCall] = useState(initial);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [focusTarget, setFocusTarget] = useState<{ id: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const isLeader = group.isLeader;
  const { sessions } = call;
  const hasStandingCall = !!(call.url || call.time);

  useEffect(() => {
    if (focusTarget) document.getElementById(focusTarget.id)?.focus();
  }, [focusTarget]);

  if (sessions.length === 0 && !hasStandingCall && !isLeader) return null;

  const memberName = (id: string | null) =>
    id ? members.find((m) => m.id === id)?.name ?? null : null;
  const memberLabel = (id: string) =>
    id === NONE ? "No leader" : members.find((m) => m.id === id)?.name ?? "";
  const leaderIds = [NONE, ...members.map((m) => m.id)];

  const startEditing = () => {
    setErrors({});
    setEditing({
      drafts: sessions.length > 0 ? sessions.map(toDraft) : [{ ...EMPTY_DRAFT }],
      url: call.url ?? "",
      time: call.time ?? "",
    });
  };

  const setDrafts = (update: (drafts: Draft[]) => Draft[]) =>
    setEditing((e) => (e ? { ...e, drafts: update(e.drafts) } : e));

  const setField = (i: number, key: keyof Draft, value: string) => {
    setDrafts((d) => d.map((x, j) => (j === i ? { ...x, [key]: value } : x)));
    setErrors({});
  };

  const save = async () => {
    if (!editing) return;
    const kept = editing.drafts.filter(
      (d) => d.start_time || d.dial_in.trim() || d.join_url.trim()
    );
    const found = validate(editing, kept);
    setErrors(found);
    const firstInvalid = Object.keys(found)[0];
    if (firstInvalid) {
      setFocusTarget({ id: firstInvalid });
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

    let errMsg = await savePrayerCallSessions(
      supabase,
      orgId,
      group.id,
      group.name,
      timeZone,
      sessionDrafts,
      removed
    );

    const url = editing.url.trim() || null;
    const time = editing.time.trim() || null;
    if (!errMsg && (url !== call.url || time !== call.time)) {
      const { data, error } = await supabase
        .from("group_settings")
        .upsert({
          group_id: group.id,
          weekly_prayer_call_url: url,
          weekly_prayer_call_time: time,
          updated_by: userId,
          updated_at: new Date().toISOString(),
        })
        .select("group_id");
      if (error || !data?.length) errMsg = failureMessage("save the call details");
    }

    const { data: fresh, error: fetchError } = await supabase
      .from("prayer_call_sessions")
      .select("*")
      .eq("group_id", group.id)
      .order("display_order")
      .order("created_at");
    setSaving(false);

    if (errMsg || fetchError) {
      // Carry the ids of rows that did get written back into the drafts, so
      // retrying updates them instead of inserting duplicates.
      setDrafts((cur) =>
        cur.map((d) => {
          const i = kept.indexOf(d);
          if (i === -1) return d;
          const saved = sessionDrafts[i];
          return { ...d, id: saved.id, event_id: saved.event_id };
        })
      );
      toast.error(errMsg ?? failureMessage("save the call details"));
      return;
    }
    setCall({ sessions: (fresh ?? []).map(toCallSession), url, time });
    setEditing(null);
    toast.success("Prayer call saved.");
  };

  const joinUrl = sessions.find((s) => s.join_url)?.join_url ?? null;
  const dialSession = sessions.find((s) => s.dial_in) ?? null;

  return (
    <section
      aria-labelledby="prayer-call-title"
      className="rounded-2xl border border-border bg-card p-5 md:p-6"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 id="prayer-call-title" className="text-xl font-semibold text-foreground">
          The prayer call
        </h2>
        {isLeader && !editing && (
          <Button variant="outline" onClick={startEditing}>
            <Pencil aria-hidden="true" />
            Edit call
          </Button>
        )}
      </div>
      <p className="mt-2 text-base text-muted-foreground">
        Everyone in the group is welcome. Each call time is also on the group calendar.
      </p>

      {editing ? (
        <div className="mt-5 flex flex-col gap-4">
          {editing.drafts.map((d, i) => {
            const startId = `call-${i}-start`;
            const joinId = `call-${i}-join`;
            const zoneNoteId = `call-${i}-zone`;
            const startInvalid = invalidFieldProps(startId, errors[startId]);
            return (
              <fieldset
                key={d.id ?? `new-${i}`}
                className="flex flex-col gap-4 rounded-xl border border-border p-4"
              >
                <legend className="text-base font-semibold text-foreground">
                  Call time {i + 1}
                </legend>
                <div className="space-y-2">
                  <Label htmlFor={`call-${i}-day`} className="text-base">Day</Label>
                  <Select
                    items={WEEKDAY_OPTIONS}
                    value={d.weekday}
                    onValueChange={(v) => setField(i, "weekday", v ?? d.weekday)}
                  >
                    <SelectTrigger id={`call-${i}-day`} className="w-full">
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
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor={startId} className="text-base">Starts</Label>
                    <Input
                      id={startId}
                      type="time"
                      value={d.start_time}
                      onChange={(e) => setField(i, "start_time", e.target.value)}
                      {...startInvalid}
                      aria-describedby={[zoneNoteId, startInvalid["aria-describedby"]]
                        .filter(Boolean)
                        .join(" ")}
                    />
                    <FieldError fieldId={startId} message={errors[startId]} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`call-${i}-end`} className="text-base">Ends (optional)</Label>
                    <Input
                      id={`call-${i}-end`}
                      type="time"
                      value={d.end_time}
                      onChange={(e) => setField(i, "end_time", e.target.value)}
                      aria-describedby={zoneNoteId}
                    />
                  </div>
                </div>
                <p id={zoneNoteId} className="text-base text-muted-foreground">
                  Times are in {zoneName(timeZone)}.
                </p>
                <div className="space-y-2">
                  <Label htmlFor={`call-${i}-leader`} className="text-base">Call leader</Label>
                  <Combobox
                    items={leaderIds}
                    itemToStringLabel={memberLabel}
                    value={d.leader_id}
                    onValueChange={(v) => setField(i, "leader_id", v ?? NONE)}
                  >
                    <ComboboxInput
                      id={`call-${i}-leader`}
                      placeholder="Search members…"
                      className="h-12 w-full rounded-lg border border-input bg-transparent px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
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
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor={`call-${i}-dial`} className="text-base">Dial-in number</Label>
                    <Input
                      id={`call-${i}-dial`}
                      type="tel"
                      value={d.dial_in}
                      onChange={(e) => setField(i, "dial_in", e.target.value)}
                      placeholder="(770) 555-0170"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`call-${i}-pin`} className="text-base">PIN</Label>
                    <Input
                      id={`call-${i}-pin`}
                      value={d.pin}
                      onChange={(e) => setField(i, "pin", e.target.value)}
                      placeholder="4412#"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor={joinId} className="text-base">Join link (optional)</Label>
                  <Input
                    id={joinId}
                    type="url"
                    value={d.join_url}
                    onChange={(e) => setField(i, "join_url", e.target.value)}
                    placeholder="https://…"
                    {...invalidFieldProps(joinId, errors[joinId])}
                  />
                  <FieldError fieldId={joinId} message={errors[joinId]} />
                </div>
                {editing.drafts.length > 1 && (
                  <Button
                    variant="destructive"
                    className="self-start"
                    onClick={() => setDrafts((cur) => cur.filter((_, j) => j !== i))}
                  >
                    <Trash2 aria-hidden="true" />
                    Delete call time
                  </Button>
                )}
              </fieldset>
            );
          })}
          <Button
            variant="outline"
            onClick={() => setDrafts((cur) => [...cur, { ...EMPTY_DRAFT }])}
          >
            <Plus aria-hidden="true" />
            Add call time
          </Button>

          <div className="space-y-2">
            <Label htmlFor="call-time-note" className="text-base">When the group calls (optional)</Label>
            <Input
              id="call-time-note"
              value={editing.time}
              onChange={(e) => setEditing({ ...editing, time: e.target.value })}
              placeholder="Tuesdays at 7am"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="call-link" className="text-base">Call link (optional)</Label>
            <Input
              id="call-link"
              type="url"
              value={editing.url}
              onChange={(e) => {
                setEditing({ ...editing, url: e.target.value });
                setErrors({});
              }}
              placeholder="https://…"
              {...invalidFieldProps("call-link", errors["call-link"])}
            />
            <FieldError fieldId="call-link" message={errors["call-link"]} />
          </div>

          <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row">
            <Button onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save call"}
            </Button>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={saving}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <>
          {hasStandingCall && (
            <div className="mt-4 rounded-xl border border-border px-4 py-3 text-base">
              {call.time && <div className="font-semibold text-foreground">{call.time}</div>}
              {call.url && (
                <a
                  href={call.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center break-all text-brand-primary-text underline underline-offset-4 hover:text-foreground"
                >
                  {call.url}
                </a>
              )}
            </div>
          )}

          {sessions.length > 0 ? (
            <>
              <ul className="mt-4 flex flex-col gap-3">
                {sessions.map((s) => {
                  const leaderName = memberName(s.leader_id);
                  return (
                    <li
                      key={s.id}
                      className="flex items-start gap-3.5 rounded-xl border border-border px-4 py-3"
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-warm">
                        <Phone className="h-5 w-5 text-brand-primary-text" aria-hidden="true" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-lg font-semibold text-foreground">{sessionLabel(s)}</div>
                        {leaderName && (
                          <div className="text-base text-muted-foreground">Led by {leaderName}</div>
                        )}
                        {(s.dial_in || s.pin) && (
                          <div className="font-mono text-base text-foreground">
                            {s.dial_in && (
                              <a
                                href={telHref(s.dial_in, s.pin)}
                                className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-brand-primary-text"
                              >
                                {s.dial_in}
                              </a>
                            )}
                            {s.dial_in && s.pin && " · "}
                            {s.pin && `PIN ${s.pin}`}
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-3 text-sm text-muted-foreground">Times are in {zoneName(timeZone)}.</p>
              {joinUrl ? (
                <Button
                  className="mt-4 w-full"
                  nativeButton={false}
                  render={<a href={joinUrl} target="_blank" rel="noopener noreferrer" />}
                >
                  Join the call
                </Button>
              ) : dialSession?.dial_in ? (
                // tel: with DTMF pauses enters the PIN automatically on a phone;
                // on desktop the link is harmless, so it shows everywhere.
                <Button
                  className="mt-4 w-full"
                  nativeButton={false}
                  render={<a href={telHref(dialSession.dial_in, dialSession.pin)} />}
                >
                  <Phone aria-hidden="true" />
                  Call in
                </Button>
              ) : null}
            </>
          ) : (
            isLeader && (
              <Button variant="outline" className="mt-4 w-full" onClick={startEditing}>
                <Plus aria-hidden="true" />
                Add call details
              </Button>
            )
          )}
        </>
      )}
    </section>
  );
}
