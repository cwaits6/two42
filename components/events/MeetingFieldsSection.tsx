"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { FieldError, invalidFieldProps } from "@/components/ui/field-error";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const LEAD_OPTIONS = ["5", "15", "30", "60"] as const;

const LEAD_LABELS: Record<string, string> = {
  "5": "5 minutes",
  "15": "15 minutes",
  "30": "30 minutes",
  "60": "1 hour",
};

const LEAD_ITEMS = LEAD_OPTIONS.map((value) => ({ value, label: LEAD_LABELS[value] }));

export type MeetingFieldErrors = { meeting_url?: string };

/** The meeting fields' own rules; empty when the meeting is valid or left out. */
export function meetingFieldErrors(
  meetingUrl: string,
  meetingId: string,
  passcode: string
): MeetingFieldErrors {
  const url = meetingUrl.trim();
  if (url && !/^https:\/\//i.test(url)) {
    return { meeting_url: "Enter a meeting link that starts with https://" };
  }
  if (!url && (meetingId.trim() || passcode.trim())) {
    return { meeting_url: "Enter the meeting link that goes with the meeting ID and passcode." };
  }
  return {};
}

interface MeetingFieldsSectionProps {
  meetingUrl: string;
  onMeetingUrlChange: (v: string) => void;
  meetingId: string;
  onMeetingIdChange: (v: string) => void;
  passcode: string;
  onPasscodeChange: (v: string) => void;
  showOnDashboard: boolean;
  onShowOnDashboardChange: (v: boolean) => void;
  leadMinutes: string;
  onLeadMinutesChange: (v: string) => void;
  isRecurring: boolean;
  errors?: MeetingFieldErrors;
}

export function MeetingFieldsSection({
  meetingUrl,
  onMeetingUrlChange,
  meetingId,
  onMeetingIdChange,
  passcode,
  onPasscodeChange,
  showOnDashboard,
  onShowOnDashboardChange,
  leadMinutes,
  onLeadMinutesChange,
  isRecurring,
  errors = {},
}: MeetingFieldsSectionProps) {
  return (
    <div className="space-y-4 rounded-2xl border border-border bg-background p-4">
      <div>
        <h2 className="font-sans text-lg font-medium text-foreground">Online meeting</h2>
        <p className="text-base text-muted-foreground">
          {isRecurring
            ? "One link for every date of this event."
            : "Members get a Join button on the group dashboard and the event page when it is time."}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="meeting_url" className="text-lg">Meeting link</Label>
        <Input
          id="meeting_url"
          type="text"
          inputMode="url"
          placeholder="https://us02web.zoom.us/j/…"
          value={meetingUrl}
          onChange={(e) => onMeetingUrlChange(e.target.value)}
          className="text-lg"
          {...invalidFieldProps("meeting_url", errors.meeting_url)}
        />
        <FieldError fieldId="meeting_url" message={errors.meeting_url} />
        <p className="text-base text-muted-foreground">
          Use the invite link with the passcode embedded so one tap joins.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="meeting_id" className="text-lg">Meeting ID</Label>
          <Input
            id="meeting_id"
            value={meetingId}
            onChange={(e) => onMeetingIdChange(e.target.value)}
            className="text-lg"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="meeting_passcode" className="text-lg">Passcode</Label>
          <Input
            id="meeting_passcode"
            value={passcode}
            onChange={(e) => onPasscodeChange(e.target.value)}
            className="text-lg"
          />
        </div>
      </div>

      {meetingUrl.trim() && (
        <>
          <div className="flex items-center gap-3">
            <Switch
              id="meeting_show_on_dashboard"
              checked={showOnDashboard}
              onCheckedChange={onShowOnDashboardChange}
            />
            <Label htmlFor="meeting_show_on_dashboard" className="text-lg">
              Show join button on dashboard
            </Label>
          </div>

          <div className="space-y-2">
            <Label htmlFor="meeting_lead_minutes" className="text-lg">Join opens before start</Label>
            <Select
              items={LEAD_ITEMS}
              value={leadMinutes}
              onValueChange={(v) => {
                if (v) onLeadMinutesChange(v);
              }}
            >
              <SelectTrigger id="meeting_lead_minutes" className="w-full text-lg">
                <SelectValue>{LEAD_LABELS[leadMinutes] ?? `${leadMinutes} minutes`}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {LEAD_ITEMS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </>
      )}
    </div>
  );
}
