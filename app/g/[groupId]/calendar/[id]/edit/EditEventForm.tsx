"use client";

import { useEffect, useMemo, useState } from "react";
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
import { addHour, formatDateTimeLocal, isValidEndTime } from "@/lib/datetime-local";
import type { Event } from "@/lib/types";

type EditScope = "all" | "this";

const SCOPE_ITEMS = [
  { value: "this", label: "This event only" },
  { value: "all", label: "All events in series" },
];

export function EditEventForm({ groupId, eventId }: { groupId: string; eventId: string }) {
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
  const [loadState, setLoadState] = useState<"loading" | "ready" | "not-found">("loading");
  const [editScope, setEditScope] = useState<EditScope>("all");
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = useMemo(() => createClient(), []);

  const calendarHref = groupPath(groupId, "/calendar");
  const detailHref = groupPath(groupId, `/calendar/${eventId}`);

  // Occurrence param is set when navigating from a specific recurring occurrence.
  const rawOccurrence = searchParams.get("occurrence");
  const occurrenceISO = rawOccurrence ? decodeURIComponent(rawOccurrence) : null;

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
        nextStartTime = formatDateTimeLocal(new Date(occurrenceISO));
        if (eventData.end_time) {
          const duration =
            new Date(eventData.end_time).getTime() - new Date(eventData.start_time).getTime();
          nextEndTime = formatDateTimeLocal(new Date(new Date(occurrenceISO).getTime() + duration));
        } else {
          nextEndTime = "";
        }
      } else {
        nextStartTime = formatDateTimeLocal(new Date(eventData.start_time));
        nextEndTime = eventData.end_time ? formatDateTimeLocal(new Date(eventData.end_time)) : "";
      }
      setStartTime(nextStartTime);
      setEndTime(isValidEndTime(nextStartTime, nextEndTime) ? nextEndTime : addHour(nextStartTime));
      setLoadState("ready");
    }
    load();
  }, [occurrenceISO, eventId, groupId, supabase]);

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

      let occurrenceEnd: string | null = null;
      if (event.end_time) {
        const duration =
          new Date(event.end_time).getTime() - new Date(event.start_time).getTime();
        occurrenceEnd = new Date(new Date(occurrenceISO).getTime() + duration).toISOString();
      }

      const { error } = await supabase.from("events").insert({
        title,
        description,
        location: nextLocation || null,
        start_time: new Date(occurrenceISO).toISOString(),
        end_time: occurrenceEnd,
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
    const { data: updated, error } = await supabase
      .from("events")
      .update({
        title,
        description,
        location: nextLocation || null,
        start_time: new Date(formData.get("start_time") as string).toISOString(),
        end_time: (formData.get("end_time") as string)
          ? new Date(formData.get("end_time") as string).toISOString()
          : null,
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

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this event?")) return;

    const { data: deleted, error } = await supabase
      .from("events")
      .delete()
      .eq("id", eventId)
      .eq("group_id", groupId)
      .select("id");

    if (error || !deleted?.length) {
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
          <Link href={calendarHref} className="text-brand-primary hover:underline">
            Back to the calendar
          </Link>
        </p>
      </div>
    );
  }

  const isRecurringSeries = !!event.recurrence_frequency && !event.series_id;
  const showScopeChoice = isRecurringSeries && !!occurrenceISO;

  const occurrenceLabel = occurrenceISO
    ? new Date(occurrenceISO).toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : null;

  return (
    <div className="container mx-auto px-4 py-12 max-w-2xl">
      <GoogleMapsScript />
      <Card>
        <CardHeader>
          <CardTitle className="text-3xl text-brand-primary">Edit Event</CardTitle>
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
                className="flex-1 text-lg py-6 bg-brand-primary hover:bg-brand-primary/90 text-white"
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
                onClick={handleDelete}
              >
                Delete
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
