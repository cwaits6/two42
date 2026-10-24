"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface RemoveMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  personName: string;
  orgName: string;
  onConfirm: () => Promise<void>;
}

export function RemoveMemberDialog({
  open,
  onOpenChange,
  personName,
  orgName,
  onConfirm,
}: RemoveMemberDialogProps) {
  const [removing, setRemoving] = useState(false);

  async function confirm() {
    setRemoving(true);
    await onConfirm();
    setRemoving(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove {personName} from this group?</DialogTitle>
          <DialogDescription className="text-base">
            They keep their {orgName} profile and stay in their other groups.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={removing}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={removing}>
            {removing ? "Removing…" : "Remove"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
