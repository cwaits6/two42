"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { failureMessage } from "@/lib/errorCopy";

interface NotificationsCardProps {
  userId: string;
  initialEmailAnnouncements: boolean;
}

export function NotificationsCard({
  userId,
  initialEmailAnnouncements,
}: NotificationsCardProps) {
  const [emailAnnouncements, setEmailAnnouncements] = useState(
    initialEmailAnnouncements,
  );
  const [saving, setSaving] = useState(false);
  const supabase = createClient();

  // The switch is disabled while a save is pending, so updates can't
  // overlap and a stale response can't clobber a newer selection.
  const handleChange = async (next: boolean) => {
    setSaving(true);
    setEmailAnnouncements(next);
    const { error } = await supabase
      .from("profiles")
      .update({ email_announcements: next })
      .eq("id", userId);
    if (error) {
      console.error(error);
      setEmailAnnouncements(!next);
      toast.error(failureMessage("save your email setting"));
    }
    setSaving(false);
  };

  return (
    <Card>
      <CardContent className="pt-6">
        <h2 className="mb-2 text-2xl">Notifications</h2>
        <p className="mb-4 text-base text-muted-foreground">Saved as soon as you change it.</p>
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="email-announcements" className="text-base font-semibold">
            Email me new announcements
          </Label>
          <Switch
            id="email-announcements"
            checked={emailAnnouncements}
            onCheckedChange={handleChange}
            disabled={saving}
          />
        </div>
      </CardContent>
    </Card>
  );
}
