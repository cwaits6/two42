"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { failureMessage } from "@/lib/errorCopy";
import { createClient } from "@/lib/supabase/client";

type Option = { value: string; label: string };

const ME = "me";

/** Joins the waiting list of a rotation whose tables are published, alone or with one other person. */
export function WaitlistForm({ rotationId, meId, partners }: { rotationId: string; meId: string; partners: Option[] }) {
  const router = useRouter();
  const id = useId();
  const [who, setWho] = useState(ME);
  const [saving, setSaving] = useState(false);
  const items: Option[] = [{ value: ME, label: "Just me" }, ...partners];

  async function join() {
    setSaving(true);
    const { error } = await createClient().rpc("supper_party_create", {
      _rotation_id: rotationId,
      _profile_ids: who === ME ? [meId] : [meId, who],
    });
    setSaving(false);
    if (error?.code === "23505") return toast.error("Someone in this party is already signed up for this rotation.");
    if (error) return toast.error(failureMessage("join the waiting list"));
    toast.success("You're on the waiting list.");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl font-bold">Join the waiting list</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-lg">The tables are set. The leader seats you when there&apos;s room, and you get an email.</p>
        <div className="space-y-2">
          <Label htmlFor={id} className="text-lg">
            Who&apos;s coming
          </Label>
          <Select items={items} value={who} disabled={saving} onValueChange={(next) => next && setWho(next)}>
            <SelectTrigger id={id} className="h-12 w-full text-lg">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {items.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="text-base text-muted-foreground">Tell the leader about any food needs.</p>
        <Button size="lg" onClick={join} disabled={saving}>
          {saving ? "Joining…" : "Join the waiting list"}
        </Button>
      </CardContent>
    </Card>
  );
}
