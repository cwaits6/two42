"use client";

import { ConfirmDialog } from "@/components/ConfirmDialog";

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
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Remove ${personName} from this group?`}
      description={`They keep their ${orgName} profile and stay in their other groups.`}
      confirmLabel="Remove from group"
      pendingLabel="Removing…"
      onConfirm={onConfirm}
    />
  );
}
