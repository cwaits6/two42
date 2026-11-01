import type { Profile, UserRole } from "@/lib/types";

export const ROLE_LABELS: Record<UserRole, string> = {
  pending: "Pending",
  member: "Member",
  admin: "Church admin",
};

/**
 * What the role control offers. Pending is not a role to pick: moving someone
 * back to pending takes their group access away, so it is its own action.
 */
export const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: "member", label: ROLE_LABELS.member },
  { value: "admin", label: ROLE_LABELS.admin },
];

export interface RoleChangeCopy {
  title: string;
  description: string;
  confirmLabel: string;
}

/** The question asked before a role is saved; one mis-tap must not change anyone's access. */
export function roleChangeCopy(name: string, from: UserRole, to: UserRole): RoleChangeCopy {
  if (to === "admin") {
    return {
      title: `Make ${name} a church admin?`,
      description: "They'll be able to manage the church's people, households, groups and settings.",
      confirmLabel: "Make church admin",
    };
  }
  if (to === "pending") {
    return {
      title: `Move ${name} back to pending?`,
      description: "They'll lose access to their groups and teams. Both come back when they're approved again.",
      confirmLabel: "Move to pending",
    };
  }
  if (from === "pending") {
    return {
      title: `Approve ${name} as a member?`,
      description: "They'll get access to the church and any groups and teams they're already in.",
      confirmLabel: "Approve member",
    };
  }
  return {
    title: `Change ${name} to member?`,
    description: "They'll lose access to the church admin pages.",
    confirmLabel: "Change to member",
  };
}

/**
 * Why this row's role can't be changed here, or null when it can. Only the
 * viewer's own row is locked. The database refuses the last admin's demotion
 * whichever row it comes from; this says so before anyone tries.
 */
export function roleLockReason(
  member: Pick<Profile, "id">,
  viewerId: string | null,
  members: Pick<Profile, "role">[],
): string | null {
  if (member.id !== viewerId) return null;
  const admins = members.filter((m) => m.role === "admin").length;
  return admins <= 1
    ? "A church needs at least one church admin, so add another before changing your role."
    : "Another church admin can change your role.";
}
