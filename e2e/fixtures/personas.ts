// Accounts from supabase/seed.sql, chosen for the boundary each spec needs.
// Group B and Group C carry the ids the seed inserts; Group A is the
// migration-created group and has no fixed id, so no spec addresses it by
// URL.

export const PASSWORD = "password123";

export const ORG_NAME = "Sample Organization";

export const GROUP_B = "c0000000-0000-0000-0000-00000000000b";
export const GROUP_C = "c0000000-0000-0000-0000-00000000000c";

export const PERSONAS = {
  /** Org admin; leads Group A, member of Group B. */
  admin: { email: "admin@local.dev", name: "Local Admin" },
  /** Member of Group B only. */
  oneGroup: { email: "isaac.seedly@example.test", name: "Isaac Seedly" },
  /** Member of Group B and Group C. */
  twoGroups: { email: "leo.loremsworth@example.test", name: "Leo Loremsworth" },
  /** Leads Group C; in no other group. */
  leadsC: { email: "amelia.demoski@example.test", name: "Amelia Demoski" },
} as const;

export type PersonaKey = keyof typeof PERSONAS;
