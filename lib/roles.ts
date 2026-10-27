import type { UserRole } from "@/lib/types";

// Rows can still hold the retired `content_editor` role until the contract
// migration moves them to `member`; delete it from both places below once
// that migration is live.

/** Stored `profiles.role` values that read as members, for query filters. */
export const STORED_MEMBER_ROLES = ["member", "admin", "content_editor"];

/**
 * Read a stored `profiles.role` as an app role. An unrecognized value reads
 * as `pending`, so it grants nothing.
 */
export function toUserRole(stored: string): UserRole {
  switch (stored) {
    case "admin":
    case "member":
    case "pending":
      return stored;
    case "content_editor":
      return "member";
    default:
      return "pending";
  }
}

/** An approved principal: a member or an admin. */
export function isMemberRole(stored: string): boolean {
  return toUserRole(stored) !== "pending";
}
