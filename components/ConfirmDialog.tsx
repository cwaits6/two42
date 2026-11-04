"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  /** Longer content, such as lists, that can't sit inside the description's paragraph. */
  children?: ReactNode;
  confirmLabel: string;
  pendingLabel?: string;
  cancelLabel?: string;
  /** For a confirmation that destroys nothing. */
  confirmVariant?: "destructive" | "default";
  onConfirm: () => Promise<void>;
}

// The caller closes the dialog once its action succeeds; a failed action
// leaves it open so the person can retry or back out. Escape and the overlay
// are ignored while the action runs, so the caller never sees a cancel for an
// action that then completes.
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  confirmLabel,
  pendingLabel = confirmLabel,
  cancelLabel = "Cancel",
  confirmVariant = "destructive",
  onConfirm,
}: ConfirmDialogProps) {
  const [pending, setPending] = useState(false);

  async function handleConfirm() {
    setPending(true);
    try {
      await onConfirm();
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && pending) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && (
            <DialogDescription className="text-base">{description}</DialogDescription>
          )}
        </DialogHeader>
        {children}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button variant={confirmVariant} onClick={handleConfirm} disabled={pending}>
            {pending ? pendingLabel : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
