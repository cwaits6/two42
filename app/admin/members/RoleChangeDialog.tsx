"use client";

import { useMemo } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { failureMessage } from "@/lib/errorCopy";
import { createClient } from "@/lib/supabase/client";
import type { UserRole } from "@/lib/types";
import { roleChangeCopy } from "./memberRoles";

// Raised by the profiles trigger when a change would leave the church with
// no church admin.
const LAST_CHURCH_ADMIN = "CA001";

export interface RoleChange {
  member: { id: string; name: string; role: UserRole };
  role: UserRole;
}

/** Asks before a role is saved, then saves it. Open while `change` is set. */
export function RoleChangeDialog({
  change,
  onClose,
  onSaved,
}: {
  change: RoleChange | null;
  onClose: () => void;
  /** The role may have changed: called after a save, and after the database refuses one. */
  onSaved: () => void | Promise<void>;
}) {
  const supabase = useMemo(() => createClient(), []);
  const copy = change && roleChangeCopy(change.member.name, change.member.role, change.role);

  async function save({ member, role }: RoleChange) {
    const { data, error } = await supabase
      .from("profiles")
      .update({ role })
      .eq("id", member.id)
      .select("id");

    if (error?.code === LAST_CHURCH_ADMIN) {
      toast.error("Couldn't change this role. A church needs at least one church admin.");
      onClose();
      await onSaved();
      return;
    }
    if (error || !data?.length) {
      toast.error(failureMessage("change this role"));
      return;
    }

    toast.success("Role changed.");
    onClose();
    await onSaved();
  }

  return (
    <ConfirmDialog
      open={change !== null}
      onOpenChange={(open) => !open && onClose()}
      title={copy?.title ?? ""}
      description={copy?.description}
      confirmLabel={copy?.confirmLabel ?? ""}
      pendingLabel="Saving…"
      onConfirm={async () => {
        if (change) await save(change);
      }}
    />
  );
}
