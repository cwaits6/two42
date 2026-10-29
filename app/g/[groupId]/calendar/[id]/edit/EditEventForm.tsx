"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { GoogleMapsScript } from "@/components/GoogleMapsScript";
import { LocationInput } from "@/components/events/LocationInput";
import { MeetingFieldsSection } from "@/components/events/MeetingFieldsSection";
import { groupPath } from "@/lib/groups/active";
import { addHour, isValidEndTime } from "@/lib/datetime-local";
import { countUpcomingOccurrences, occurrenceEndTime } from "@/lib/recurrence";
import { formatEventDate, isoToLocalInput, localToUTCISO } from "@/lib/time/zone";
import type { Event } from "@/lib/types";
import { DeleteEventDialog } from "./DeleteEventDialog";
import { cancelOccurrence, deleteEvent } from "./deleteEvent";

type EditScope = "all" | "this";

const SCOPE_ITEMS = [
  { value: "this", label: "This event only" },
  { value: "all", label: "All events in series" },
];

export function EditEventForm({
  groupId,
  eventId,
  timeZone,
}: {
  groupId: string;
  eventId: string;
  /** The org's zone, resolved by the server; the form's times are its wall clock. */
  timeZone: string;
}) {
  const [event, setEvent] = useState<Event | null>(null);
  const [isRsvpEnabled, setIsRsvpEnabled] = useState(true);
  const [location, setLocation] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [meetingUrl, setMeetingUrl] = useState("");
  const [meetingId, setMeetingId] = useState("");
  const [meetingPasscode, setMeetingPasscode] = useState("");
  const [meetingShowOnDashboard, setMeetingShowOnDashboard] = useState(true);
  const [meetingLeadMinutes, setMeetingLeadMinutes] = useState("15");
  const [loading, setLoading] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "not-found">("loading");
  const [editScope, setEditScope] = useState<EditScope>("all");
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = useMemo(() => createClient(), []);
  // The input values as loaded, to tell whether the leader changed a time.
  const loadedTimes = useRef<{ start: string; end: string } | null>(null);

  const calendarHref = groupPath(groupId, "/calendar");
  const detailHref = groupPath(groupId, `/calendar/${eventId}`);

  // Occurrence param is set when navigating from a specific recurring occurrence.
  const rawOccurrence = searchParams.get("occurrence");
  const occurrenceISO = rawOccurrence ? decodeURIComponent(rawOccurrence) : null;

  const upcomingCount = useMemo(
    () => (event ? countUpcomingOccurrences(event, timeZone) : null),
    [event, timeZone]
  );

  useEffect(() => {
    async function load() {
      const { data: eventData, error: eventError } = await supabase
        .from("events")
        .select("*")
        .eq("id", eventId)
        .eq("group_id", groupId)
        .maybeSingle();
      if (eventError || !eventData) {
        setLoadState("not-found");
        return;
      }
      setEvent(eventData as Event);
      setIsRsvpEnabled(eventData.is_rsvp_enabled ?? true);
      setLocation(eventData.location ?? "");
      setMeetingUrl(eventData.meeting_url ?? "");
      setMeetingId(eventData.meeting_id ?? "");
      setMeetingPasscode(eventData.meeting_passcode ?? "");
      setMeetingShowOnDashboard(eventData.meeting_show_on_dashboard ?? true);
      setMeetingLeadMinutes(String(eventData.meeting_lead_minutes ?? 15));
      let nextStartTime: string;
      let nextEndTime: string;
      if (occurrenceISO) {
        nextStartTime = isoToLocalInput(occurrenceISO, timeZone);
        const occurrenceEnd = occurrenceEndTime(eventData, occurrenceISO);
        nextEndTime = occurrenceEnd ? isoToLocalInput(occurrenceEnd, timeZone) : "";
      } else {
        nextStartTime = isoToLocalInput(eventData.start_time, timeZone);
        nextEndTime = eventData.end_time ? isoToLocalInput(eventData.end_time, timeZone) : "";
      }
      loadedTimes.current = { start: nextStartTime, end: nextEndTime };
      setStartTime(nextStartTime);
      setEndTime(isValidEndTime(nextStartTime, nextEndTime) ? nextEndTime : addHour(nextStartTime));
      setLoadState("ready");
    }
    load();
  }, [occurrenceISO, eventId, groupId, supabase, timeZone]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!event) return;

    if (!isValidEndTime(startTime, endTime)) {
      toast.error("End time must be after start time.");
      return;
    }

    const isRecurringSeries = !!event.recurrence_frequency && !event.series_id;
    const isSingleOccurrenceEdit = isRecurringSeries && !!occurrenceISO && editScope === "this";

    const trimmedMeetingUrl = meetingUrl.trim();
    if (!isSingleOccurrenceEdit) {
      if (trimmedMeetingUrl && !/^https:\/\//i.test(trimmedMeetingUrl)) {
        toast.error("Meeting link must start with https://");
        return;
      }
      if (!trimmedMeetingUrl && (meetingId.trim() || meetingPasscode.trim())) {
        toast.error("Add the meeting link to go with the meeting ID and passcode.");
        return;
      }
    }

    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const nextLocation = (formData.get("location") as string)?.trim() ?? "";
    const title = formData.get("title") as string;
    const description = (formData.get("description") as string) || null;

    if (isSingleOccurrenceEdit && occurrenceISO) {
      // A one-off exception row for just this occurrence. The anchor is
      // untouched; expandOccurrences skips this date. It inherits the
      // anchor's group and calendar.
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const { error } = await supabase.from("events").insert({
        title,
        description,
        location: nextLocation || null,
        start_time: new Date(occurrenceISO).toISOString(),
        end_time: occurrenceEndTime(event, occurrenceISO),
        group_id: groupId,
        calendar_id: event.calendar_id,
        is_rsvp_enabled: isRsvpEnabled,
        created_by: user?.id,
        recurrence_frequency: null,
        recurrence_interval: 1,
        recurrence_end_mode: null,
        recurrence_count: null,
        recurrence_until: null,
        series_id: eventId,
        series_occurrence_date: new Date(occurrenceISO).toISOString(),
      });

      setLoading(false);

      if (error) {
        toast.error("Failed to create event exception.");
        return;
      }

      toast.success("This occurrence has been saved separately.");
      router.push(calendarHref);
      return;
    }

    // Edit all events in the series (or a one-off / exception event). A
    // zero-row match is a stale or cross-group id, not a success.
    // An input value reads back as the first occurrence of a repeated autumn
    // hour, so each time the leader did not touch keeps its stored instant.
    const startValue = formData.get("start_time") as string;
    const endValue = (formData.get("end_time") as string) || "";
    const timeChanges = {
      ...(startValue !== loadedTimes.current?.start
        ? { start_time: localToUTCISO(startValue, timeZone) }
        : {}),
      ...(endValue !== loadedTimes.current?.end
        ? { end_time: endValue ? localToUTCISO(endValue, timeZone) : null }
        : {}),
    };
    const { data: updated, error } = await supabase
      .from("events")
      .update({
        title,
        description,
        location: nextLocation || null,
        ...timeChanges,
        is_rsvp_enabled: isRsvpEnabled,
        meeting_url: trimmedMeetingUrl || null,
        meeting_id: meetingId.trim() || null,
        meeting_passcode: meetingPasscode.trim() || null,
        meeting_show_on_dashboard: meetingShowOnDashboard,
        meeting_lead_minutes: Number(meetingLeadMinutes),
      })
      .eq("id", eventId)
      .eq("group_id", groupId)
      .select("id");

    setLoading(false);

    if (error || !updated?.length) {
      toast.error("Failed to update event.");
      return;
    }

    toast.success("Event updated!");
    router.replace(detailHref);
    router.refresh();
  };

  const handleStartTimeChange = (nextStartTime: string) => {
    const previousSuggestedEndTime = addHour(startTime);
    setStartTime(nextStartTime);

    if (!endTime || endTime === previousSuggestedEndTime || !isValidEndTime(nextStartTime, endTime)) {
      setEndTime(addHour(nextStartTime));
    }
  };

  const handleDeleteDate = async () => {
    if (!event || !occurrenceISO) return;
    if (!(await cancelOccurrence(supabase, event, occurrenceISO))) {
      toast.error("Failed to delete this date.");
      return;
    }
    toast.success("This date has been deleted.");
    router.push(calendarHref);
  };

  const handleDeleteAll = async () => {
    if (!(await deleteEvent(supabase, eventId, groupId))) {
      toast.error("Failed to delete event.");
      return;
    }
    toast.success("Event deleted.");
    router.push(calendarHref);
  };

  if (loadState === "loading") {
    return (
      <div className="container mx-auto px-4 py-12">
        <p className="text-xl text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (loadState === "not-found" || !event) {
    return (
      <div className="container mx-auto px-4 py-12">
        <p className="text-xl text-muted-foreground">
          Event not found.{" "}
          <Link href={calendarHref} className="text-brand-primary-text hover:underline">
            Back to the calendar
          </Link>
        </p>
      </div>
    );
  }

  const isRecurringSeries = !!event.recurrence_frequency && !event.series_id;
  const showScopeChoice = isRecurringSeries && !!occurrenceISO;

  const occurrenceLabel = occurrenceISO ? formatEventDate(occurrenceISO, timeZone) : null;

  return (
    <div className="container mx-auto px-4 py-12 max-w-2xl">
      <GoogleMapsScript />
      <Card>
        <CardHeader>
          <CardTitle className="text-3xl text-brand-primary-text">Edit Event</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">

            {/* Scope choice — only shown for recurring series occurrences */}
            {showScopeChoice && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 space-y-3">
                <div>
                  <p className="text-sm font-semibold text-amber-800">Recurring event</p>
                  <p className="text-sm text-amber-700">
                    You are editing the <span className="font-medium">{occurrenceLabel}</span> occurrence.
                    Choose whether to save changes for just this date or the whole series.
                  </p>
                </div>
                <Select
                  items={SCOPE_ITEMS}
                  value={editScope}
                  onValueChange={(v) => setEditScope((v ?? "all") as EditScope)}
                >
                  <SelectTrigger className="w-full text-base py-5 bg-white">
                    <SelectValue>
                      {editScope === "this" ? "This event only" : "All events in series"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {SCOPE_ITEMS.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="title" className="text-lg">Title</Label>
              <Input id="title" name="title" required defaultValue={event.title} className="text-lg py-6" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description" className="text-lg">Description</Label>
              <Textarea id="description" name="description" rows={4} defaultValue={event.description || ""} className="text-lg" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="location" className="text-lg">Location</Label>
              <LocationInput
                id="location"
                name="location"
                value={location}
                onChange={setLocation}
              />
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="start_time" className="text-lg">Start Time</Label>
                <Input
                  id="start_time"
                  name="start_time"
                  type="datetime-local"
                  required
                  className="text-lg py-6"
                  value={startTime}
                  onChange={(e) => handleStartTimeChange(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="end_time" className="text-lg">End Time</Label>
                <Input
                  id="end_time"
                  name="end_time"
                  type="datetime-local"
                  className="text-lg py-6"
                  min={startTime || undefined}
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Switch
                id="is_rsvp_enabled"
                checked={isRsvpEnabled}
                onCheckedChange={setIsRsvpEnabled}
              />
              <Label htmlFor="is_rsvp_enabled" className="text-lg">RSVP enabled</Label>
            </div>

            {/* Meeting lives on the series anchor — hidden when saving a single
                occurrence, which inherits the series meeting. */}
            {!(showScopeChoice && editScope === "this") && (
              <MeetingFieldsSection
                meetingUrl={meetingUrl}
                onMeetingUrlChange={setMeetingUrl}
                meetingId={meetingId}
                onMeetingIdChange={setMeetingId}
                passcode={meetingPasscode}
                onPasscodeChange={setMeetingPasscode}
                showOnDashboard={meetingShowOnDashboard}
                onShowOnDashboardChange={setMeetingShowOnDashboard}
                leadMinutes={meetingLeadMinutes}
                onLeadMinutesChange={setMeetingLeadMinutes}
                isRecurring={isRecurringSeries}
              />
            )}

            <div className="flex gap-3">
              <Button
                type="submit"
                size="lg"
                className="flex-1 text-lg py-6"
                disabled={loading}
              >
                {loading ? "Saving..." : "Save Changes"}
              </Button>
              <Button
                type="button"
                size="lg"
                variant="outline"
                className="text-lg py-6"
                onClick={() => router.push(detailHref)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="lg"
                variant="destructive"
                className="text-lg py-6"
                onClick={() => setConfirmingDelete(true)}
              >
                Delete
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
      <DeleteEventDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        series={isRecurringSeries ? { upcomingCount } : null}
        occurrenceLabel={showScopeChoice ? occurrenceLabel : null}
        onDeleteDate={handleDeleteDate}
        onDeleteAll={handleDeleteAll}
      />
    </div>
  );
}
