import { matchesSearch } from "@/components/admin/adminSearch";
import { displayName } from "@/lib/names";
import type { AccessRequest, Profile } from "@/lib/types";
import type { AssignedRole } from "./memberRoles";

export const STATUS_LABELS = { invited: "Invited", pending: "Pending" } as const;
export type MemberStatus = keyof typeof STATUS_LABELS;
export type RoleFilter = "all" | AssignedRole;
export type StatusFilter = "all" | MemberStatus;

export interface MemberRow {
  key: string;
  /** Null for a person who was invited and has no account to open. */
  profileId: string | null;
  name: string;
  email: string | null;
  /** Null until the person has signed up and been approved. */
  role: AssignedRole | null;
  status: MemberStatus | null;
  search: (string | null)[];
}

/** One row per person and per invite still waiting on a sign-up, sorted by the name shown. */
export function toMemberRows(
  members: Pick<Profile, "id" | "first_name" | "last_name" | "preferred_name" | "email" | "role">[],
  invited: Pick<AccessRequest, "id" | "name" | "email">[],
): MemberRow[] {
  const rows: MemberRow[] = [
    ...members.map((m) => ({
      key: m.id,
      profileId: m.id,
      name: displayName(m),
      email: m.email,
      role: m.role === "pending" ? null : m.role,
      status: m.role === "pending" ? ("pending" as const) : null,
      search: [displayName(m), m.first_name, m.last_name, m.email],
    })),
    ...invited.map((r) => ({
      key: `invite-${r.id}`,
      profileId: null,
      name: r.name,
      email: r.email,
      role: null,
      status: "invited" as const,
      search: [r.name, r.email],
    })),
  ];
  return rows.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

function matches(row: MemberRow, query: string, role: RoleFilter): boolean {
  // Someone with no role yet is nobody's answer to "show me the church admins".
  return (role === "all" || row.role === role) && matchesSearch(query, row.search);
}

export function filterMemberRows(
  rows: MemberRow[],
  { query, role, status }: { query: string; role: RoleFilter; status: StatusFilter },
): MemberRow[] {
  return rows.filter((row) => (status === "all" || row.status === status) && matches(row, query, role));
}

/** What each status tab would show under this search and role, so a tab's count is its row count. */
export function statusCounts(
  rows: MemberRow[],
  { query, role }: { query: string; role: RoleFilter },
): Record<StatusFilter, number> {
  const counts: Record<StatusFilter, number> = { all: 0, invited: 0, pending: 0 };
  for (const row of rows) {
    if (!matches(row, query, role)) continue;
    counts.all += 1;
    if (row.status) counts[row.status] += 1;
  }
  return counts;
}

export type MemberAction = "edit" | "pending" | "delete";

/**
 * What a row's menu offers. Nobody moves themselves to pending or deletes
 * their own account from here, and an invite has no account to act on. With
 * the viewer unknown any row could be their own, so every row offers Edit only.
 */
export function memberActions(row: MemberRow, viewerId: string | null): MemberAction[] {
  if (row.profileId === null) return [];
  if (viewerId === null || row.profileId === viewerId) return ["edit"];
  return row.status === "pending" ? ["edit", "delete"] : ["edit", "pending", "delete"];
}
