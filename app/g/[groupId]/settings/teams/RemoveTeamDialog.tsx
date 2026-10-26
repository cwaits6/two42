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
import type { MemberGroup } from "@/lib/types";

interface RemoveTeamDialogProps {
  team: MemberGroup | null;
  memberCount: number;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}

function membersText(n: number): string {
  if (n === 0) return "No one is on this team yet.";
  return `${n} member${n === 1 ? "" : "s"} will be taken off this team.`;
}

export function RemoveTeamDialog({
  team,
  memberCount,
  onCancel,
  onConfirm,
}: RemoveTeamDialogProps) {
  const [removing, setRemoving] = useState(false);

  async function handleConfirm() {
    setRemoving(true);
    try {
      await onConfirm();
    } finally {
      setRemoving(false);
    }
  }

  return (
    <Dialog open={team !== null} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove {team?.name}?</DialogTitle>
          <DialogDescription className="text-base">
            {membersText(memberCount)}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={removing}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={removing}>
            {removing ? "Removing…" : "Remove team"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
