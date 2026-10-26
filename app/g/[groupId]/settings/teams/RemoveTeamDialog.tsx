"use client";

import { ConfirmDialog } from "@/components/ConfirmDialog";
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
  return (
    <ConfirmDialog
      open={team !== null}
      onOpenChange={(open) => !open && onCancel()}
      title={`Remove ${team?.name}?`}
      description={membersText(memberCount)}
      confirmLabel="Remove team"
      pendingLabel="Removing…"
      onConfirm={onConfirm}
    />
  );
}
