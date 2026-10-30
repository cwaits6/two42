"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { Settings } from "lucide-react";
import { toast } from "sonner";

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
  const [windowWeeks, setWindowWeeks] = useState(settings?.window_weeks ?? 8);
  const [saving, setSaving] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  async function save() {
    setSaving(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error } = await supabase.from("serving_team_settings").upsert({
      team_id: teamId,
      enabled,
      reminder_days: reminderDays,
      window_weeks: Math.max(1, Math.min(26, windowWeeks)),
      updated_by: user?.id,
    });
    setSaving(false);

    if (error) {
      toast.error("Failed to save settings.");
      return;
    }
    toast.success("Settings saved.");
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
          <DialogTitle>Serving team settings</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-2">
          {/* Enabled */}
          <div className="flex items-center justify-between">
            <Label htmlFor="st-enabled" className="text-base">
              Signups enabled
            </Label>
            <Switch
              id="st-enabled"
              checked={enabled}
              onCheckedChange={setEnabled}
            />
          </div>

          {/* Reminder days */}
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

          {/* Window weeks */}
          <div className="space-y-2">
            <Label htmlFor="st-weeks" className="text-base">
              Schedule window (weeks)
            </Label>
            <p className="text-base text-muted-foreground">
              How many upcoming weeks to show (1–26).
            </p>
            <input
              id="st-weeks"
              type="number"
              min={1}
              max={26}
              value={windowWeeks}
              onChange={(e) => setWindowWeeks(Number(e.target.value))}
              className="h-12 w-24 rounded-md border border-border bg-background px-3 text-base focus:outline-none focus:ring-2 focus:ring-brand-primary"
            />
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
