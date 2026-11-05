import { isMemberRole } from "@/lib/roles";

/** A PostgREST `.single()` that found no row: the row is missing, not unreadable. */
export const NO_ROW = "PGRST116";

export type Landing = "platform" | "waiting" | "home";

/**
 * Where a signed-in person belongs. `profile` is null when they have no row:
 * an operator is created without one, and belongs to no church.
 *
 * Both inputs are server-owned state about the signed-in person. Nothing from
 * the request reaches this decision, so it cannot be steered to another path.
 */
export function landingFor(profile: { role: string } | null, isOperator: boolean): Landing {
  if (!profile) return isOperator ? "platform" : "waiting";
  return isMemberRole(profile.role) ? "home" : "waiting";
}
