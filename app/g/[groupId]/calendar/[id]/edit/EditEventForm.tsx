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
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { GoogleMapsScript } from "@/components/GoogleMapsScript";
import { EventTimeFields } from "@/components/events/EventTimeFields";
import { LocationInput } from "@/components/events/LocationInput";
import { MeetingFieldsSection, meetingFieldErrors, type MeetingFieldErrors } from "@/components/events/MeetingFieldsSection";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { groupPath } from "@/lib/groups/active";
import { addHour, isValidEndTime } from "@/lib/datetime-local";
import { failureMessage } from "@/lib/errorCopy";
import { countUpcomingOccurrences, occurrenceEndTime } from "@/lib/recurrence";
import { formatEventDate, isoToLocalInput, localToUTCISO } from "@/lib/time/zone";
import type { Event } from "@/lib/types";
import { DeleteEventDialog } from "./DeleteEventDialog";
import { cancelOccurrence, deleteEvent } from "./deleteEvent";

type EditScope = "all" | "this";

const SCOPE_ITEMS = [
  { value: "this", label: "This date only" },
  { value: "all", label: "Every date" },
];

type FieldErrors = MeetingFieldErrors & { end_time?: string };

/** The start and end inputs as loaded: the occurrence's own when the form was opened for one date. */
function loadedTimes(event: Event, occurrenceISO: string | null, timeZone: string) {
  if (occurrenceISO) {
    const occurrenceEnd = occurrenceEndTime(event, occurrenceISO);
    return {
      start: isoToLocalInput(occurrenceISO, timeZone),
      end: occurrenceEnd ? isoToLocalInput(occurrenceEnd, timeZone) : "",
    };
  }
  return {
    start: isoToLocalInput(event.start_time, timeZone),
    end: event.end_time ? isoToLocalInput(event.end_time, timeZone) : "",
  };
}

export function EditEventForm({
  groupId,
  event,
  timeZone,
}: {
  groupId: string;
  event: Event;
  /** The org's zone, resolved by the server; the form's times are its wall clock. */
  timeZone: string;
}) {
  const eventId = event.id;
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = useMemo(() => createClient(), []);

  // Occurrence param is set when navigating from a specific recurring occurrence.
  const rawOccurrence = searchParams.get("occurrence");
  const occurrenceISO = rawOccurrence ? decodeURIComponent(rawOccurrence) : null;
  // The input values as loaded, to tell whether the leader changed a time.
  const [loaded] = useState(() => loadedTimes(event, occurrenceISO, timeZone));

  const [isRsvpEnabled, setIsRsvpEnabled] = useState(event.is_rsvp_enabled ?? true);
  const [location, setLocation] = useState(event.location ?? "");
  const [startTime, setStartTime] = useState(loaded.start);
  const [endTime, setEndTime] = useState(() =>
    isValidEndTime(loaded.start, loaded.end) ? loaded.end : addHour(loaded.start)
  );
  const [meetingUrl, setMeetingUrl] = useState(event.meeting_url ?? "");
  const [meetingId, setMeetingId] = useState(event.meeting_id ?? "");
  const [meetingPasscode, setMeetingPasscode] = useState(event.meeting_passcode ?? "");
  const [meetingShowOnDashboard, setMeetingShowOnDashboard] = useState(event.meeting_show_on_dashboard ?? true);
  const [meetingLeadMinutes, setMeetingLeadMinutes] = useState(String(event.meeting_lead_minutes ?? 15));
  const [loading, setLoading] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [editScope, setEditScope] = useState<EditScope>("all");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [focusTarget, setFocusTarget] = useState<{ id: string } | null>(null);

  const calendarHref = groupPath(groupId, "/calendar");
  const detailHref = groupPath(
    groupId,
    `/calendar/${eventId}${occurrenceISO ? `?occurrence=${encodeURIComponent(occurrenceISO)}` : ""}`
  );

  const upcomingCount = useMemo(() => countUpcomingOccurrences(event, timeZone), [event, timeZone]);

  useEffect(() => {
    if (focusTarget) document.getElementById(focusTarget.id)?.focus();
  }, [focusTarget]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const isRecurringSeries = !!event.recurrence_frequency && !event.series_id;
    const isSingleOccurrenceEdit = isRecurringSeries && !!occurrenceISO && editScope === "this";

    const found: FieldErrors = {};
    if (!isValidEndTime(startTime, endTime)) {
      found.end_time = "Enter an end time after the start time.";
    }
    const trimmedMeetingUrl = meetingUrl.trim();
    if (!isSingleOccurrenceEdit) {
      Object.assign(found, meetingFieldErrors(trimmedMeetingUrl, meetingId, meetingPasscode));
    }
    setErrors(found);
    const firstInvalid = Object.keys(found)[0];
    if (firstInvalid) {
      setFocusTarget({ id: firstInvalid });
      return;
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
        toast.error(failureMessage("save this date"));
        return;
      }

      toast.success("Date saved.");
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
      ...(startValue !== loaded.start
        ? { start_time: localToUTCISO(startValue, timeZone) }
        : {}),
      ...(endValue !== loaded.end
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
      toast.error(failureMessage("save the event"));
      return;
    }

    toast.success("Event saved.");
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
    if (!occurrenceISO) return;
    if (!(await cancelOccurrence(supabase, event, occurrenceISO))) {
      toast.error(failureMessage("delete this date"));
      return;
    }
    toast.success("Date deleted.");
    router.push(calendarHref);
  };

  const handleDeleteAll = async () => {
    if (!(await deleteEvent(supabase, eventId, groupId))) {
      toast.error(failureMessage("delete the event"));
      return;
    }
    toast.success("Event deleted.");
    router.push(calendarHref);
  };

  const isRecurringSeries = !!event.recurrence_frequency && !event.series_id;
  const showScopeChoice = isRecurringSeries && !!occurrenceISO;

  const occurrenceLabel = occurrenceISO ? formatEventDate(occurrenceISO, timeZone) : null;

  return (
    <PageContainer size="reading">
      <GoogleMapsScript />
      <PageHeader
        title="Edit event"
        subtitle={event.title}
        backHref={detailHref}
        backLabel={`Back to ${event.title}`}
      />
      <Card>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {showScopeChoice && (
              <div className="space-y-3 rounded-2xl border border-brand-accent/50 bg-brand-bg-light/40 p-4">
                <div>
                  <h2 className="font-sans text-lg font-semibold text-foreground">Repeating event</h2>
                  <p className="text-base text-muted-foreground">
                    You&apos;re editing the date <span className="font-medium text-foreground">{occurrenceLabel}</span>.
                    Save your changes for this date only, or for every date.
                  </p>
                </div>
                <Label htmlFor="edit_scope" className="sr-only">Save changes for</Label>
                <Select
                  items={SCOPE_ITEMS}
                  value={editScope}
                  onValueChange={(v) => setEditScope((v ?? "all") as EditScope)}
                >
                  <SelectTrigger id="edit_scope" className="w-full bg-card text-base">
                    <SelectValue>
                      {editScope === "this" ? "This date only" : "Every date"}
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
              <Input id="title" name="title" required defaultValue={event.title} className="text-lg" />
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

            <EventTimeFields
              startTime={startTime}
              endTime={endTime}
              onStartTimeChange={handleStartTimeChange}
              onEndTimeChange={setEndTime}
              timeZone={timeZone}
              endError={errors.end_time}
            />

            <div className="flex items-center gap-3">
              <Switch
                id="is_rsvp_enabled"
                checked={isRsvpEnabled}
                onCheckedChange={setIsRsvpEnabled}
              />
              <Label htmlFor="is_rsvp_enabled" className="text-lg">Ask for RSVPs</Label>
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
                errors={errors}
              />
            )}

            <div className="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row">
              <Button type="submit" size="lg" disabled={loading}>
                {loading ? "Saving…" : "Save changes"}
              </Button>
              <Button size="lg" variant="outline" nativeButton={false} render={<Link href={detailHref} />}>
                Cancel
              </Button>
              <Button
                type="button"
                size="lg"
                variant="destructive"
                className="sm:ml-auto"
                onClick={() => setConfirmingDelete(true)}
              >
                Delete event
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
    </PageContainer>
  );
}
