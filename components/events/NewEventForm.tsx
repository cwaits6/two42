"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
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
import { ensureGroupCalendar } from "@/lib/groups/calendar";
import { groupPath } from "@/lib/groups/active";
import { addHour, isValidEndTime } from "@/lib/datetime-local";
import { localToUTCISO } from "@/lib/time/zone";

type RecurrenceFrequency = "daily" | "weekly" | "monthly" | "yearly";
type RecurrenceEndMode = "never" | "count" | "until";

const RECURRENCE_LABELS: Record<RecurrenceFrequency, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  yearly: "Yearly",
};

const END_MODE_LABELS: Record<RecurrenceEndMode, string> = {
  never: "Never",
  count: "After Number Of Times",
  until: "On Date",
};

const RECURRENCE_ITEMS = (Object.keys(RECURRENCE_LABELS) as RecurrenceFrequency[]).map(
  (value) => ({ value, label: RECURRENCE_LABELS[value] })
);
const END_MODE_ITEMS = (Object.keys(END_MODE_LABELS) as RecurrenceEndMode[]).map(
  (value) => ({ value, label: END_MODE_LABELS[value] })
);

interface NewEventFormProps {
  groupId: string;
  groupName: string;
  /** The caller's own org, resolved server-side; stamps the calendar insert when one is needed. */
  orgId: string;
  /** The group's calendar, or null when the group has none yet. */
  calendarId: string | null;
  /** The org's zone, resolved by the server; the form's times are its wall clock. */
  timeZone: string;
}

export function NewEventForm({ groupId, groupName, orgId, calendarId, timeZone }: NewEventFormProps) {
  const [loading, setLoading] = useState(false);
  const [isRsvpEnabled, setIsRsvpEnabled] = useState(true);
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrenceFrequency, setRecurrenceFrequency] = useState<RecurrenceFrequency>("weekly");
  const [recurrenceEndMode, setRecurrenceEndMode] = useState<RecurrenceEndMode>("never");
  const [recurrenceCount, setRecurrenceCount] = useState("4");
  const [recurrenceUntil, setRecurrenceUntil] = useState("");
  const [location, setLocation] = useState("");
  const [meetingUrl, setMeetingUrl] = useState("");
  const [meetingId, setMeetingId] = useState("");
  const [meetingPasscode, setMeetingPasscode] = useState("");
  const [meetingShowOnDashboard, setMeetingShowOnDashboard] = useState(true);
  const [meetingLeadMinutes, setMeetingLeadMinutes] = useState("15");
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();
  const calendarHref = groupPath(groupId, "/calendar");

  const rawDate = searchParams.get("date");
  const prefillDate = rawDate ? rawDate.split("T")[0] : null;
  const initialStartTime = useMemo(
    () => (prefillDate ? `${prefillDate}T09:00` : ""),
    [prefillDate]
  );
  const [startTime, setStartTime] = useState(initialStartTime);
  const [endTime, setEndTime] = useState(() => addHour(initialStartTime));

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!isValidEndTime(startTime, endTime)) {
      toast.error("End time must be after start time.");
      return;
    }

    const parsedRecurrenceCount = Number(recurrenceCount);
    if (
      isRecurring &&
      recurrenceEndMode === "count" &&
      (!Number.isInteger(parsedRecurrenceCount) || parsedRecurrenceCount < 2 || parsedRecurrenceCount > 999)
    ) {
      toast.error("Recurring events must repeat between 2 and 999 times.");
      return;
    }

    if (isRecurring && recurrenceEndMode === "until") {
      if (!recurrenceUntil) {
        toast.error("Choose when the recurring event should stop repeating.");
        return;
      }

      const untilDate = new Date(recurrenceUntil);
      const firstStartDate = new Date(startTime);
      // Both are datetime-local strings (same timezone offset implicit), so
      // comparing them as browser-local Dates is valid for ordering checks.
      if (Number.isNaN(untilDate.getTime()) || untilDate.getTime() < firstStartDate.getTime()) {
        toast.error("Repeat until must be on or after the first event.");
        return;
      }
    }

    const trimmedMeetingUrl = meetingUrl.trim();
    if (trimmedMeetingUrl && !/^https:\/\//i.test(trimmedMeetingUrl)) {
      toast.error("Meeting link must start with https://");
      return;
    }
    if (!trimmedMeetingUrl && (meetingId.trim() || meetingPasscode.trim())) {
      toast.error("Add the meeting link to go with the meeting ID and passcode.");
      return;
    }

    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const nextLocation = (formData.get("location") as string)?.trim() ?? "";
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const title = formData.get("title") as string;
    const description = (formData.get("description") as string) || null;

    const resolvedCalendarId =
      calendarId ?? (await ensureGroupCalendar(supabase, orgId, groupId, groupName));
    if (!resolvedCalendarId) {
      setLoading(false);
      toast.error("Failed to create event.");
      return;
    }

    const { error } = await supabase.from("events").insert({
      title,
      description,
      location: nextLocation || null,
      start_time: localToUTCISO(startTime, timeZone),
      end_time: endTime ? localToUTCISO(endTime, timeZone) : null,
      group_id: groupId,
      calendar_id: resolvedCalendarId,
      is_rsvp_enabled: isRsvpEnabled,
      created_by: user?.id,
      recurrence_frequency: isRecurring ? recurrenceFrequency : null,
      recurrence_interval: 1,
      recurrence_end_mode: isRecurring ? recurrenceEndMode : null,
      recurrence_count: isRecurring && recurrenceEndMode === "count" ? parsedRecurrenceCount : null,
      recurrence_until:
        isRecurring && recurrenceEndMode === "until"
          ? localToUTCISO(recurrenceUntil, timeZone)
          : null,
      meeting_url: trimmedMeetingUrl || null,
      meeting_id: meetingId.trim() || null,
      meeting_passcode: meetingPasscode.trim() || null,
      meeting_show_on_dashboard: meetingShowOnDashboard,
      meeting_lead_minutes: Number(meetingLeadMinutes),
    });

    setLoading(false);

    if (error) {
      toast.error("Failed to create event.");
      return;
    }

    toast.success("Event created.");
    router.push(calendarHref);
  };

  const handleStartTimeChange = (nextStartTime: string) => {
    const previousSuggestedEndTime = addHour(startTime);
    setStartTime(nextStartTime);

    if (!endTime || endTime === previousSuggestedEndTime) {
      setEndTime(addHour(nextStartTime));
    }
  };

  return (
    <PageContainer size="reading">
      <GoogleMapsScript />
      <PageHeader
        title="Add event"
        subtitle={`Posting to ${groupName}`}
        backHref={calendarHref}
        backLabel="Back to Calendar"
      />
      <Card>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="title" className="text-lg">Title</Label>
              <Input id="title" name="title" required className="text-lg py-6" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description" className="text-lg">Description</Label>
              <Textarea id="description" name="description" rows={4} className="text-lg" />
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

            <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
              <div className="flex items-center gap-3">
                <Switch
                  id="is_recurring"
                  checked={isRecurring}
                  onCheckedChange={setIsRecurring}
                />
                <div>
                  <Label htmlFor="is_recurring" className="text-lg">Recurring event</Label>
                  <p className="text-sm text-muted-foreground">
                    Repeat this event on a schedule.
                  </p>
                </div>
              </div>

              {isRecurring && (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label className="text-lg">Repeat</Label>
                      <Select
                        items={RECURRENCE_ITEMS}
                        value={recurrenceFrequency}
                        onValueChange={(value) => setRecurrenceFrequency((value ?? "weekly") as RecurrenceFrequency)}
                      >
                        <SelectTrigger className="w-full text-lg py-6">
                          <SelectValue>{RECURRENCE_LABELS[recurrenceFrequency]}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {RECURRENCE_ITEMS.map((item) => (
                            <SelectItem key={item.value} value={item.value}>
                              {item.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-lg">End Repeat</Label>
                      <Select
                        items={END_MODE_ITEMS}
                        value={recurrenceEndMode}
                        onValueChange={(value) => setRecurrenceEndMode((value ?? "never") as RecurrenceEndMode)}
                      >
                        <SelectTrigger className="w-full text-lg py-6">
                          <SelectValue>{END_MODE_LABELS[recurrenceEndMode]}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {END_MODE_ITEMS.map((item) => (
                            <SelectItem key={item.value} value={item.value}>
                              {item.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {recurrenceEndMode === "count" && (
                    <div className="space-y-2">
                      <Label htmlFor="recurrence_count" className="text-lg">Occurrences</Label>
                      <Input
                        id="recurrence_count"
                        type="number"
                        min="2"
                        max="999"
                        step="1"
                        value={recurrenceCount}
                        onChange={(e) => setRecurrenceCount(e.target.value)}
                        className="text-lg py-6"
                      />
                    </div>
                  )}

                  {recurrenceEndMode === "until" && (
                    <div className="space-y-2">
                      <Label htmlFor="recurrence_until" className="text-lg">Repeat Until</Label>
                      <Input
                        id="recurrence_until"
                        type="datetime-local"
                        min={startTime || undefined}
                        value={recurrenceUntil}
                        onChange={(e) => setRecurrenceUntil(e.target.value)}
                        className="text-lg py-6"
                      />
                    </div>
                  )}
                </>
              )}
            </div>

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
              isRecurring={isRecurring}
            />

            <div className="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row">
              <Button type="submit" size="lg" disabled={loading}>
                {loading ? "Saving…" : "Save event"}
              </Button>
              <Button
                type="button"
                size="lg"
                variant="outline"
                onClick={() => router.push(calendarHref)}
                disabled={loading}
              >
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </PageContainer>
  );
}
