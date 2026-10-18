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
import { Switch } from "@/components/ui/switch";
import { Settings } from "lucide-react";
import { toast } from "sonner";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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

  function toggleDay(dow: number) {
    setReminderDays((prev) =>
      prev.includes(dow) ? prev.filter((d) => d !== dow) : [...prev, dow].sort()
    );
  }

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
      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
        <Settings className="h-4 w-4" />
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
            <p className="text-sm text-muted-foreground">
              Send reminder emails on these days of the week.
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              {DAY_LABELS.map((label, dow) => (
                <button
                  key={dow}
                  type="button"
                  aria-pressed={reminderDays.includes(dow)}
                  onClick={() => toggleDay(dow)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                    reminderDays.includes(dow)
                      ? "bg-brand-primary text-white border-brand-primary"
                      : "border-border text-muted-foreground hover:border-brand-primary/50"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Window weeks */}
          <div className="space-y-2">
            <Label htmlFor="st-weeks" className="text-base">
              Schedule window (weeks)
            </Label>
            <p className="text-sm text-muted-foreground">
              How many upcoming Sundays to show (1–26).
            </p>
            <input
              id="st-weeks"
              type="number"
              min={1}
              max={26}
              value={windowWeeks}
              onChange={(e) => setWindowWeeks(Number(e.target.value))}
              className="w-24 rounded-md border border-border bg-background px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-brand-primary"
            />
          </div>

          <Button
            onClick={save}
            disabled={saving}
            className="w-full bg-brand-primary hover:bg-brand-primary/90 text-white"
          >
            {saving ? "Saving…" : "Save settings"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
