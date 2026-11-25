"use client";

import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isoToLocalInput, localToUTCISO } from "@/lib/time/zone";

/** Asks for a new date and time, in the church's zone, and hands back the instant. */
export function MoveDialog({
  open,
  onOpenChange,
  title,
  description,
  initialIso,
  zone,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  initialIso: string;
  zone: string;
  /** Resolves true when the move was saved, which closes the dialog. */
  onSave: (iso: string) => Promise<boolean>;
}) {
  const id = useId();
  const [value, setValue] = useState(() => isoToLocalInput(initialIso, zone));
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) setValue(isoToLocalInput(initialIso, zone));
  }, [open, initialIso, zone]);

  async function save() {
    if (!value) return;
    setSaving(true);
    const saved = await onSave(localToUTCISO(value, zone));
    setSaving(false);
    if (saved) onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="text-base">{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor={id} className="text-lg">
            New date and time
          </Label>
          <Input id={id} type="datetime-local" value={value} className="h-12 text-lg" onChange={(e) => setValue(e.target.value)} />
        </div>
        <div className="flex flex-col gap-3 sm:flex-row-reverse">
          <Button size="lg" onClick={save} disabled={saving || !value}>
            {saving ? "Saving…" : "Save date"}
          </Button>
          <Button size="lg" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** POSTs a move to one of the dinner club routes; true when it was saved. */
export async function postMove(url: string, startsAt: string): Promise<{ ok: boolean; message?: string }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startsAt }),
    });
    if (res.ok) return { ok: true };
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, message: res.status === 400 || res.status === 409 ? body?.error : undefined };
  } catch {
    return { ok: false };
  }
}
