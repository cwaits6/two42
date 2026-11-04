"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldError, invalidFieldProps } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Segmented } from "@/components/ui/segmented";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Settings } from "lucide-react";
import { toast } from "sonner";
import { failureMessage } from "@/lib/errorCopy";
import {
  MAX_EXTRA_WEEKS,
  MAX_WINDOW_WEEKS,
  blockError,
  sundaysLabel,
  windowWeeksError,
} from "@/lib/serving/dates";
import { DEFAULT_SEND_HOUR, SEND_HOUR_OPTIONS } from "@/lib/serving/reminders";

const DAY_OPTIONS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label, dow) => ({
  value: dow,
  label,
}));

const SCHEDULE_OPTIONS = [
  { value: "rolling", label: "Rolling" },
  { value: "set", label: "Set dates" },
] as const;

const EXTRA_WEEKS_OPTIONS = Array.from({ length: MAX_EXTRA_WEEKS + 1 }, (_, n) => ({
  value: n,
  label: n === 0 ? "No" : `${n} more`,
}));

interface ServingSettingsDialogProps {
  teamId: string;
  settings: {
    enabled: boolean;
    reminder_days: number[];
    schedule: "rolling" | "set";
    window_weeks: number;
    date_from: string | null;
    date_to: string | null;
    extra_weeks: number;
    send_hour: number | null;
  } | null;
}

export function ServingSettingsDialog({ teamId, settings }: ServingSettingsDialogProps) {
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(settings?.enabled ?? false);
  const [reminderDays, setReminderDays] = useState<number[]>(settings?.reminder_days ?? [4, 5]);
  const [schedule, setSchedule] = useState<"rolling" | "set">(settings?.schedule ?? "rolling");
  const [windowWeeks, setWindowWeeks] = useState(String(settings?.window_weeks ?? 8));
  const [dateFrom, setDateFrom] = useState(settings?.date_from ?? "");
  const [dateTo, setDateTo] = useState(settings?.date_to ?? "");
  const [extraWeeks, setExtraWeeks] = useState(settings?.extra_weeks ?? 0);
  // The hour applies either way; it is stored only once someone picks one,
  // so an untouched team stays "not chosen".
  const [sendHour, setSendHour] = useState(String(settings?.send_hour ?? DEFAULT_SEND_HOUR));
  const [sendHourChosen, setSendHourChosen] = useState(false);
  const [weeksError, setWeeksError] = useState<string | undefined>();
  const [datesError, setDatesError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const weeksRef = useRef<HTMLInputElement>(null);
  const fromRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const supabase = createClient();
  const id = useId();
  const enabledId = `${id}-enabled`;
  const weeksId = `${id}-weeks`;
  const fromId = `${id}-from`;
  const toId = `${id}-to`;
  const hourId = `${id}-hour`;

  const blockCount = schedule === "set" && !blockError(dateFrom, dateTo) ? sundaysLabel(dateFrom, dateTo) : null;

  async function save() {
    const weeksProblem = schedule === "rolling" ? windowWeeksError(windowWeeks) : undefined;
    const datesProblem = schedule === "set" ? blockError(dateFrom, dateTo) : undefined;
    setWeeksError(weeksProblem);
    setDatesError(datesProblem);
    if (weeksProblem) {
      weeksRef.current?.focus();
      return;
    }
    if (datesProblem) {
      fromRef.current?.focus();
      return;
    }

    setSaving(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    // A write the RLS policy rejects matches zero rows without an error.
    const { data, error: saveError } = await supabase
      .from("serving_team_settings")
      .upsert({
        team_id: teamId,
        enabled,
        reminder_days: reminderDays,
        schedule,
        window_weeks: schedule === "rolling" ? Number(windowWeeks) : (settings?.window_weeks ?? 8),
        date_from: schedule === "set" ? dateFrom : null,
        date_to: schedule === "set" ? dateTo : null,
        extra_weeks: extraWeeks,
        send_hour: sendHourChosen ? Number(sendHour) : (settings?.send_hour ?? null),
        updated_by: user?.id,
      })
      .select("team_id");
    setSaving(false);

    if (saveError || !data?.length) {
      toast.error(failureMessage("save the team settings"));
      return;
    }
    toast.success("Team settings saved.");
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Settings aria-hidden="true" />
        Team settings
      </Button>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Team settings</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-2">
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor={enabledId} className="text-base">
              People can sign up
            </Label>
            <Switch id={enabledId} checked={enabled} onCheckedChange={setEnabled} />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <Label className="text-base">Serving dates</Label>
              {blockCount && <span className="text-base text-muted-foreground">{blockCount}</span>}
            </div>
            <Segmented
              label="Serving dates"
              options={SCHEDULE_OPTIONS}
              value={schedule}
              onChange={setSchedule}
              className="w-full *:flex-1"
            />
            {schedule === "rolling" ? (
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <Label htmlFor={weeksId} className="text-base">
                    Next
                  </Label>
                  <Input
                    ref={weeksRef}
                    id={weeksId}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={MAX_WINDOW_WEEKS}
                    value={windowWeeks}
                    onChange={(e) => setWindowWeeks(e.target.value)}
                    className="w-20"
                    {...invalidFieldProps(weeksId, weeksError)}
                  />
                  <span className="text-base">weeks</span>
                </div>
                <FieldError fieldId={weeksId} message={weeksError} />
              </div>
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor={fromId} className="text-base">
                      From
                    </Label>
                    <Input
                      ref={fromRef}
                      id={fromId}
                      type="date"
                      value={dateFrom}
                      onChange={(e) => setDateFrom(e.target.value)}
                      {...invalidFieldProps(fromId, datesError)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={toId} className="text-base">
                      To
                    </Label>
                    <Input
                      id={toId}
                      type="date"
                      value={dateTo}
                      onChange={(e) => setDateTo(e.target.value)}
                      {...invalidFieldProps(toId, datesError)}
                    />
                  </div>
                </div>
                <FieldError fieldId={fromId} message={datesError} />
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label className="text-base">Ask for more weeks?</Label>
            <Segmented
              label="Ask for more weeks?"
              options={EXTRA_WEEKS_OPTIONS}
              value={extraWeeks}
              onChange={setExtraWeeks}
              className="w-full *:flex-1"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-base">Reminder email days</Label>
            <Segmented
              label="Reminder email days"
              multiple
              options={DAY_OPTIONS}
              value={reminderDays}
              onChange={(days) => setReminderDays(days.sort((a, b) => a - b))}
            />
          </div>

          <div className="flex items-center justify-between gap-4">
            <Label htmlFor={hourId} className="text-base">
              Reminder email time
            </Label>
            <Select
              items={SEND_HOUR_OPTIONS}
              value={sendHour}
              onValueChange={(value) => {
                if (value === null) return;
                setSendHour(value);
                setSendHourChosen(true);
              }}
            >
              <SelectTrigger id={hourId} className="h-12 text-base" aria-label="Reminder email time">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SEND_HOUR_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button onClick={save} disabled={saving} className="w-full">
            {saving ? "Saving…" : "Save settings"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
