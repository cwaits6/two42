"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

interface SettingsMap {
  [key: string]: string;
}

const SERVING_LINK_MODE_OPTIONS = [
  { value: "signed", label: "Signed links — members act without logging in (recommended)" },
  { value: "login", label: "Login required — links redirect to the login page first" },
];

const SETTINGS_LABELS: Record<string, string> = {
  site_name: "Site Name",
  directory_app_url: "Directory App URL",
  weekly_zoom_url: "Weekly Zoom URL",
  zoom_meeting_time: "Zoom Meeting Time",
  weekly_prayer_call_url: "Weekly Prayer Call URL",
  weekly_prayer_call_time: "Weekly Prayer Call Time",
  serving_link_mode: "Serving Email Link Mode",
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<SettingsMap>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from("site_settings").select("*");
      if (data) {
        const map: SettingsMap = {};
        data.forEach((s) => {
          map[s.key] = s.value || "";
        });
        setSettings(map);
      }
      setLoading(false);
    }
    load();
  }, [supabase]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);

    const { data: { user } } = await supabase.auth.getUser();

    const updates = Object.entries(settings).map(([key, value]) =>
      supabase
        .from("site_settings")
        .update({
          value,
          updated_by: user?.id,
          updated_at: new Date().toISOString(),
        })
        .eq("key", key)
    );

    const results = await Promise.all(updates);
    const hasError = results.some((r) => r.error);

    setSaving(false);

    if (hasError) {
      toast.error("Failed to save some settings.");
    } else {
      toast.success("Settings saved!");
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-12">
        <p className="text-xl text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-12 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-3xl text-brand-primary">Site Settings</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-8">
            <Button
              size="lg"
              variant="outline"
              className="text-lg"
              nativeButton={false}
              render={<Link href="/admin/settings/email" />}
            >
              Email sending domain
            </Button>
          </div>
          <form onSubmit={handleSubmit} className="space-y-6">
            {Object.entries(SETTINGS_LABELS).map(([key, label]) => (
              <div key={key} className="space-y-2">
                <Label htmlFor={key} className="text-lg">{label}</Label>
                {key === "serving_link_mode" ? (
                  <Select
                    items={SERVING_LINK_MODE_OPTIONS}
                    value={settings[key] || "signed"}
                    onValueChange={(v) =>
                      setSettings((prev) => ({ ...prev, [key]: v ?? "signed" }))
                    }
                  >
                    <SelectTrigger id={key} className="w-full text-lg py-5">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SERVING_LINK_MODE_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    id={key}
                    value={settings[key] || ""}
                    onChange={(e) =>
                      setSettings((prev) => ({ ...prev, [key]: e.target.value }))
                    }
                    placeholder={`Enter ${label.toLowerCase()}`}
                    className="text-lg py-6"
                  />
                )}
              </div>
            ))}

            <Button
              type="submit"
              size="lg"
              className="w-full text-lg py-6 bg-brand-primary hover:bg-brand-primary/90 text-white"
              disabled={saving}
            >
              {saving ? "Saving..." : "Save Settings"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
