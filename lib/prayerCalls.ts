import type { SupabaseClient } from "@supabase/supabase-js";
import { siteConfig } from "@/lib/config";
import { nextOccurrence } from "@/lib/prayer";
import type { PrayerCallSession } from "@/lib/types";

/** Editable fields of a prayer call session, as collected by the card's edit mode */
export interface SessionDraft {
  id: string | null;
  weekday: number;
  /** "HH:MM" */
  start_time: string;
  end_time: string | null;
  leader_id: string | null;
  dial_in: string | null;
  pin: string | null;
  join_url: string | null;
  event_id: string | null;
  display_order: number;
}

/**
 * Find the designated Prayer calendar via the prayer_calendar_id site
 * setting, re-creating the calendar (and repointing the setting) if an admin
 * deleted it. Returns null only if creation fails — the synced events then
 * land uncategorized rather than not at all.
 *
 * Tenancy: `orgId` scopes every chain here and in savePrayerCallSessions,
 * inserts included. A `SupabaseClient` PARAMETER is untyped as to privilege
 * — a service-role client satisfies it identically and carries BYPASSRLS —
 * so this module cannot know whether RLS is running, and the explicit
 * predicate is the only tenant boundary it can guarantee. Inserts stamp
 * org_id rather than leaning on the column DEFAULT, which only resolves for
 * an authenticated principal. A calendar id pointing at another tenant's row
 * now matches nothing and falls through to re-create, never reuses it.
 */
async function ensurePrayerCalendar(
  supabase: SupabaseClient,
  orgId: string,
  settingId: string | null
): Promise<string | null> {
  if (settingId) {
    const { data } = await supabase
      .from("event_calendars")
      .select("id")
      .eq("id", settingId)
      .eq("org_id", orgId)
      .maybeSingle();
    if (data) return data.id;
  }
  const { data: created, error } = await supabase
    .from("event_calendars")
    .insert({ name: "Prayer", color: siteConfig.colors.primary, org_id: orgId })
    .select("id")
    .single();
  if (error || !created) return null;
  const { error: repointError } = await supabase
    .from("site_settings")
    .update({ value: created.id })
    .eq("key", "prayer_calendar_id")
    .eq("org_id", orgId);
  if (repointError) {
    console.error("ensurePrayerCalendar: failed to repoint prayer_calendar_id for org %s:", orgId, repointError);
  }
  return created.id;
}

function eventFields(draft: SessionDraft, calendarId: string | null) {
  const start = nextOccurrence(draft.weekday, draft.start_time);
  let end: Date | null = null;
  if (draft.end_time) {
    end = new Date(start);
    const [h, m] = draft.end_time.split(":").map(Number);
    end.setHours(h, m, 0, 0);
    if (end <= start) end.setDate(end.getDate() + 1);
  }

  const lines: string[] = [];
  if (draft.dial_in) {
    lines.push(`Dial in: ${draft.dial_in}${draft.pin ? ` · PIN ${draft.pin}` : ""}`);
  }
  if (draft.join_url) lines.push(`Join: ${draft.join_url}`);

  return {
    title: "Prayer call",
    description: lines.length > 0 ? lines.join("\n") : null,
    start_time: start.toISOString(),
    end_time: end ? end.toISOString() : null,
    calendar_id: calendarId,
    is_rsvp_enabled: false,
    recurrence_frequency: "weekly",
    recurrence_interval: 1,
    recurrence_end_mode: "never",
  };
}

/**
 * Persist the edited session list and keep each session's weekly recurring
 * calendar event in step: removed sessions take their event with them, kept
 * sessions get theirs updated (or re-created if an admin deleted the event
 * from the calendar directly).
 *
 * Mutates each draft's `id`/`event_id` as rows are created, so on partial
 * failure the caller can carry the assigned ids back into its edit state and
 * a retry updates the already-written rows instead of inserting duplicates.
 *
 * `orgId` must come from a validated anchor — the caller's own RLS-scoped
 * profile row, resolved server-side — never from the browser or a request
 * body. See ensurePrayerCalendar for why the parameter is mandatory.
 *
 * @returns an error message to show the user, or null on success
 */
export async function savePrayerCallSessions(
  supabase: SupabaseClient,
  orgId: string,
  drafts: SessionDraft[],
  removed: PrayerCallSession[],
  calendarSettingId: string | null
): Promise<string | null> {
  const calendarId = await ensurePrayerCalendar(supabase, orgId, calendarSettingId);

  for (const s of removed) {
    // Delete the synced event first — if that fails we bail before touching
    // the session row, so a retry sees the same state and no event is
    // orphaned on the calendar.
    if (s.event_id) {
      const { error } = await supabase
        .from("events")
        .delete()
        .eq("id", s.event_id)
        .eq("org_id", orgId);
      if (error) return "Couldn't remove a session. Please try again.";
    }
    const { error } = await supabase
      .from("prayer_call_sessions")
      .delete()
      .eq("id", s.id)
      .eq("org_id", orgId);
    if (error) return "Couldn't remove a session. Please try again.";
  }

  for (const draft of drafts) {
    const fields = eventFields(draft, calendarId);

    // Sync the event first so the session row can point at it. Only an
    // error-free update that matches no rows means the event was deleted out
    // from under us (the FK already nulled event_id in the DB) — fall through
    // and re-create. A failed update must not fall through, or a transient
    // error would duplicate the event.
    let eventId = draft.event_id;
    if (eventId) {
      const { data, error } = await supabase
        .from("events")
        .update(fields)
        .eq("id", eventId)
        .eq("org_id", orgId)
        .select("id");
      if (error) {
        return "Couldn't update the calendar event. Please try again.";
      }
      if (data.length === 0) eventId = null;
    }
    if (!eventId) {
      const { data, error } = await supabase
        .from("events")
        .insert({ ...fields, org_id: orgId })
        .select("id")
        .single();
      if (error || !data) {
        return "Couldn't create the calendar event. Please try again.";
      }
      eventId = data.id;
    }
    draft.event_id = eventId;

    const row = {
      weekday: draft.weekday,
      start_time: draft.start_time,
      end_time: draft.end_time,
      leader_id: draft.leader_id,
      dial_in: draft.dial_in,
      pin: draft.pin,
      join_url: draft.join_url,
      event_id: eventId,
      display_order: draft.display_order,
    };
    if (draft.id) {
      // Mirrors the events update above: an error-free update that matches
      // zero rows (a stale or cross-org draft.id) must not report success —
      // there is no independent recreate path for a session, so surface an
      // explicit error instead of silently dropping the edit.
      const { data, error } = await supabase
        .from("prayer_call_sessions")
        .update(row)
        .eq("id", draft.id)
        .eq("org_id", orgId)
        .select("id");
      if (error || !data || data.length === 0) {
        return "Couldn't save the call details. Please try again.";
      }
    } else {
      const { data, error } = await supabase
        .from("prayer_call_sessions")
        .insert({ ...row, org_id: orgId })
        .select("id")
        .single();
      if (error || !data) {
        return "Couldn't save the call details. Please try again.";
      }
      draft.id = data.id;
    }
  }

  return null;
}
