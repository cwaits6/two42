"use client";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { isChildWithoutAccount } from "@/lib/household";
import { createClient } from "@/lib/supabase/client";
import type { FamilyMember, FamilyMemberRelationship } from "@/lib/types";

/**
 * What saving this relationship permanently deletes, in a sentence, or null when
 * it deletes nothing. The database clears the year and the invite of anyone who
 * becomes a child without an account. Throws when the invite can't be read,
 * because a save that might delete one can't go ahead unconfirmed.
 */
export async function relabelToChildLoss(
  member: Pick<FamilyMember, "id" | "relationship" | "birth_year" | "claimed_profile_id">,
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

interface Props {
  name: string;
  /** From relabelToChildLoss; the dialog is open while this is set. */
  loss: string | null;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}

export function RelabelChildConfirm({ name, loss, onCancel, onConfirm }: Props) {
  return (
    <ConfirmDialog
      open={loss !== null}
      onOpenChange={(open) => !open && onCancel()}
      title={`Change ${name} to Child?`}
      description={loss ?? undefined}
      confirmLabel="Change to Child"
      pendingLabel="Saving…"
      onConfirm={onConfirm}
    />
  );
}
