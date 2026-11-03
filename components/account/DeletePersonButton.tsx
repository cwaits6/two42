"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import {
  alreadyGoneMessage,
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
    let gone: string | undefined;
    try {
      const res = await fetch(url);
      gone = alreadyGoneMessage(res.status, subject);
      if (!gone) {
        if (!res.ok) {
          toast.error(failureMessage(action, res.status));
          return;
        }
        const summary: DeletionSummary = await res.json();
        if (summary.platformOperator) {
          toast.error(PLATFORM_OPERATOR_MESSAGE[subject]);
        } else if (summary.lastChurchAdmin) {
          toast.error(LAST_CHURCH_ADMIN_MESSAGE[subject]);
        } else {
          setCopy(deletionCopy(summary, subject));
        }
        return;
      }
    } catch {
      toast.error(NETWORK_ERROR);
      return;
    } finally {
      setLoading(false);
    }
    toast.error(gone);
    await onDeleted();
  }

  async function confirm() {
    let res: Response;
    let body: { error?: unknown; photosNotRemoved?: number } | null;
    try {
      res = await fetch(url, { method: "DELETE" });
      body = await res.json().catch(() => null);
    } catch {
      toast.error(NETWORK_ERROR);
      return;
    }

    const gone = alreadyGoneMessage(res.status, subject);
    if (gone) {
      toast.error(gone);
    } else if (!res.ok) {
      toast.error(refusalMessage(body?.error, subject) ?? failureMessage(action, res.status));
      return;
    } else if (body?.photosNotRemoved) {
      toast.error(photosNotRemovedMessage(body.photosNotRemoved, subject));
    } else if (subject === "other") {
      toast.success("Account deleted.");
    }

    // Closed and reported before the reload, which reports its own failure.
    setCopy(null);
    await onDeleted();
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
