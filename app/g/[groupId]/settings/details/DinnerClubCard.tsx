"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export function DinnerClubCard({ enabled, onChange }: { enabled: boolean; onChange: (next: boolean) => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl font-bold text-foreground">Dinner club</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="dinner_club_enabled" className="text-lg font-medium text-foreground">
            Dinner club
          </Label>
          <Switch
            id="dinner_club_enabled"
            className="shrink-0"
            checked={enabled}
            onCheckedChange={onChange}
          />
        </div>
        <p className="text-base text-muted-foreground">
          Adds the Dinner club page to the group&apos;s menu. Turning it off hides the page and keeps every season.
        </p>
      </CardContent>
    </Card>
  );
}
