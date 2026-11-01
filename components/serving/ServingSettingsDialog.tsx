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
import { Switch } from "@/components/ui/switch";
import { Settings } from "lucide-react";
import { toast } from "sonner";
import { failureMessage } from "@/lib/errorCopy";
import { MAX_WINDOW_WEEKS, windowWeeksError } from "@/lib/serving/dates";

const DAY_OPTIONS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label, dow) => ({
  value: dow,
  label,
}));

interface ServingSettingsDialogProps {
  teamId: string;
  settings: {
    enabled: boolean;
    reminder_days: number[];
    window_weeks: number;
  } | null;
}

export function ServingSettingsDialog({ teamId, settings }: ServingSettingsDialogProps) {
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(settings?.enabled ?? false);
  const [reminderDays, setReminderDays] = useState<number[]>(settings?.reminder_days ?? [4, 5]);
  const [windowWeeks, setWindowWeeks] = useState(String(settings?.window_weeks ?? 8));
  const [weeksError, setWeeksError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const weeksRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const supabase = createClient();
  const id = useId();
  const enabledId = `${id}-enabled`;
  const weeksId = `${id}-weeks`;

  async function save() {
    const error = windowWeeksError(windowWeeks);
    setWeeksError(error);
    if (error) {
      weeksRef.current?.focus();
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
        window_weeks: Number(windowWeeks),
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
              Signups on
            </Label>
            <Switch
              id={enabledId}
              checked={enabled}
              onCheckedChange={setEnabled}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-base">Reminder days</Label>
            <p className="text-base text-muted-foreground">
              Send reminder emails on these days of the week.
            </p>
            <Segmented
              label="Reminder days"
              multiple
              options={DAY_OPTIONS}
              value={reminderDays}
              onChange={(days) => setReminderDays(days.sort((a, b) => a - b))}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={weeksId} className="text-base">
              Weeks shown
            </Label>
            <p className="text-base text-muted-foreground">
              How many weeks of upcoming dates to show, from 1 to {MAX_WINDOW_WEEKS}.
            </p>
            <Input
              ref={weeksRef}
              id={weeksId}
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_WINDOW_WEEKS}
              value={windowWeeks}
              onChange={(e) => setWindowWeeks(e.target.value)}
              className="w-24"
              {...invalidFieldProps(weeksId, weeksError)}
            />
            <FieldError fieldId={weeksId} message={weeksError} />
          </div>

          <Button
            onClick={save}
            disabled={saving}
            className="w-full"
          >
            {saving ? "Saving…" : "Save settings"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
