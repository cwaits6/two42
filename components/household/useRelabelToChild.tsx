"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { failureMessage } from "@/lib/errorCopy";
import { isChildWithoutAccount } from "@/lib/household";
import { createClient } from "@/lib/supabase/client";
import type { FamilyMember, FamilyMemberRelationship } from "@/lib/types";

type RelabelledMember = Pick<FamilyMember, "id" | "relationship" | "birth_year" | "claimed_profile_id">;

/**
 * What saving this relationship permanently deletes, in a sentence, or null when
 * it deletes nothing. The database clears the year and the invite of anyone who
 * becomes a child without an account. Throws when the invite can't be read,
 * because a save that might delete one can't go ahead unconfirmed.
 */
async function relabelToChildLoss(
  member: RelabelledMember,
  relationship: FamilyMemberRelationship,
  name: string,
): Promise<string | null> {
  const becomesChild =
    isChildWithoutAccount({ relationship, claimed_profile_id: member.claimed_profile_id }) &&
    !isChildWithoutAccount(member);
  if (!becomesChild) return null;

  const { data, error } = await createClient()
    .from("family_invites")
    .select("id")
    .eq("family_member_id", member.id)
    .is("accepted_at", null)
    .limit(1);
  if (error) throw error;

  const hasYear = member.birth_year !== null;
  const hasInvite = (data ?? []).length > 0;
  if (!hasYear && !hasInvite) return null;

  const lost = [hasYear && "birth year", hasInvite && "open invite"].filter(Boolean).join(" and ");
  const link = hasInvite ? " The invite link stops working." : "";
  return `Saving deletes ${name}'s ${lost}.${link} This can't be undone.`;
}

interface Options {
  /** null when adding someone, who has nothing stored to lose. */
  member: RelabelledMember | null;
  relationship: FamilyMemberRelationship;
  name: string;
  setSaving: (saving: boolean) => void;
  /** Resolves false when the save failed, which leaves the dialog open to retry. */
  save: () => Promise<boolean>;
}

/** Runs a form's save, asking first when it would delete what relabelling to Child deletes. */
export function useRelabelToChild({ member, relationship, name, setSaving, save }: Options) {
  const [loss, setLoss] = useState<string | null>(null);

  async function saveAndClose() {
    if (await save()) setLoss(null);
  }

  async function submit() {
    if (member) {
      setSaving(true);
      let found: string | null;
      try {
        found = await relabelToChildLoss(member, relationship, name);
      } catch (err) {
        console.error(err);
        toast.error(failureMessage(`save ${name}`));
        setSaving(false);
        return;
      }
      setSaving(false);
      if (found) {
        setLoss(found);
        return;
      }
    }
    await saveAndClose();
  }

  const dialog = (
    <ConfirmDialog
      open={loss !== null}
      onOpenChange={(open) => !open && setLoss(null)}
      title={`Change ${name} to Child?`}
      description={loss ?? undefined}
      confirmLabel="Change to Child"
      pendingLabel="Saving…"
      onConfirm={saveAndClose}
    />
  );

  return { submit, dialog };
}
