"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { failureMessage } from "@/lib/errorCopy";
import { SUPPER_LENGTH_OPTIONS, isSupperLength } from "@/lib/supperClub/labels";
import { createClient } from "@/lib/supabase/client";

/** Change length, for the supper's host or a leader. Sends no email and keeps replies. */
export function SupperLengthButton({ supperId, lengthMinutes }: { supperId: string; lengthMinutes: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(String(lengthMinutes));
  const [saving, setSaving] = useState(false);

  function openDialog() {
    setValue(String(lengthMinutes));
    setOpen(true);
  }

  async function save() {
    const minutes = Number(value);
    if (!isSupperLength(minutes)) return;
    setSaving(true);
    // Row security lets the supper's host or a leader: anyone else matches no row.
    const { data, error } = await createClient()
      .from("suppers")
      .update({ length_minutes: minutes })
      .eq("id", supperId)
      .select("id");
    setSaving(false);
    if (error || !data?.length) {
      toast.error(failureMessage("change the length"));
      return;
    }
    setOpen(false);
    toast.success("Length saved.");
    router.refresh();
  }

  return (
    <>
      <Button variant="outline" size="lg" onClick={openDialog}>
        Change length
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change length</DialogTitle>
            <DialogDescription className="text-base">
              Sets when the supper ends in each person&apos;s calendar. Nobody gets an email, and replies stay.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={`supper-length-${supperId}`} className="text-lg">
              How long the supper lasts
            </Label>
            <Select items={SUPPER_LENGTH_OPTIONS} value={value} onValueChange={(next) => next && setValue(next)}>
              <SelectTrigger id={`supper-length-${supperId}`} className="h-12 w-full text-lg">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SUPPER_LENGTH_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value} className="py-3 text-lg">
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row-reverse">
            <Button size="lg" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save length"}
            </Button>
            <Button size="lg" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
