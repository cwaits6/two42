import type { UserRole } from "@/lib/types";

/**
 * Every stored `profiles.role` value and the app role it reads as. Rows can
 * still hold the retired `content_editor` until the contract migration moves
 * them to `member`; delete its entry once that migration is live.
 */
const STORED_ROLES = {
  pending: "pending",
  member: "member",
  admin: "admin",
  content_editor: "member",
} as const satisfies Record<string, UserRole>;

type StoredRole = keyof typeof STORED_ROLES;

/** Stored `profiles.role` values that read as members, for query filters. */
export const STORED_MEMBER_ROLES = (Object.keys(STORED_ROLES) as StoredRole[]).filter(
  (stored) => STORED_ROLES[stored] !== "pending"
);

/**
 * Read a stored `profiles.role` as an app role. An unrecognized value reads
 * as `pending`, so it grants nothing.
 */
export function toUserRole(stored: string): UserRole {
  return Object.hasOwn(STORED_ROLES, stored) ? STORED_ROLES[stored as StoredRole] : "pending";
}

/** An approved principal: a member or an admin. */
export function isMemberRole(stored: string): boolean {
  return toUserRole(stored) !== "pending";
}
