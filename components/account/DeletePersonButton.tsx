"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import {
  deletionCopy,
  LAST_CHURCH_ADMIN_MESSAGE,
  photosNotRemovedMessage,
  PLATFORM_OPERATOR_MESSAGE,
  refusalMessage,
  type DeletionCopy,
  type DeletionSubject,
  type DeletionSummary,
} from "@/lib/account/deletionCopy";
import { failureMessage, NETWORK_ERROR } from "@/lib/errorCopy";

const DELETED_BUT_NOT_REFRESHED = "That went through, but this page didn't update. Refresh to see it.";

function CopyList({ heading, items }: { heading: string; items: string[] }) {
  return (
    <div>
      <h3 className="text-base font-semibold">{heading}</h3>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-base text-muted-foreground">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

/** `url` answers GET with what the confirmation names, and DELETE with the deletion. */
export function DeletePersonButton({
  url,
  subject,
  label,
  ariaLabel,
  onDeleted,
}: {
  url: string;
  subject: DeletionSubject;
  label: string;
  ariaLabel?: string;
  onDeleted: () => void | Promise<void>;
}) {
  const [loading, setLoading] = useState(false);
  const [copy, setCopy] = useState<DeletionCopy | null>(null);
  const action = subject === "self" ? "delete your account" : "delete this account";

  async function openConfirmation() {
    setLoading(true);
    try {
      const res = await fetch(url);
      if (!res.ok) {
        toast.error(failureMessage(action, res.status));
        return;
      }
      const summary: DeletionSummary = await res.json();
      if (summary.platformOperator) {
        toast.error(PLATFORM_OPERATOR_MESSAGE[subject]);
        return;
      }
      if (summary.lastChurchAdmin) {
        toast.error(LAST_CHURCH_ADMIN_MESSAGE[subject]);
        return;
      }
      setCopy(deletionCopy(summary, subject));
    } catch {
      toast.error(NETWORK_ERROR);
    } finally {
      setLoading(false);
    }
  }

  async function confirm() {
    try {
      const res = await fetch(url, { method: "DELETE" });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(refusalMessage(body?.error, subject) ?? failureMessage(action, res.status));
        return;
      }
      if (body?.photosNotRemoved > 0) {
        toast.error(photosNotRemovedMessage(body.photosNotRemoved, subject));
      }
    } catch {
      toast.error(NETWORK_ERROR);
      return;
    }

    setCopy(null);
    try {
      await onDeleted();
    } catch {
      toast.error(DELETED_BUT_NOT_REFRESHED);
    }
  }

  return (
    <>
      <Button variant="destructive" onClick={openConfirmation} disabled={loading} aria-label={ariaLabel}>
        {label}
      </Button>
      <ConfirmDialog
        open={copy !== null}
        onOpenChange={(open) => !open && setCopy(null)}
        title={copy?.title ?? ""}
        description={copy?.description}
        confirmLabel={copy?.confirmLabel ?? ""}
        pendingLabel={copy?.pendingLabel}
        onConfirm={confirm}
      >
        {copy && (
          <div className="space-y-3">
            <CopyList heading="What goes" items={copy.goes} />
            <CopyList heading="What stays" items={copy.stays} />
          </div>
        )}
      </ConfirmDialog>
    </>
  );
}
