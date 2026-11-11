/**
 * What /api/auth/verify-token and /api/auth/setup-account answer, shared
 * with the setup form. Client-safe: no server-only imports.
 */
export const SETUP_STATUS = {
  /** The link already created its account (409). */
  setUp: "set_up",
  /** Another account already uses the link's email (409). */
  accountExists: "account_exists",
} as const;

export type SetupStatus = (typeof SETUP_STATUS)[keyof typeof SETUP_STATUS];

export type SetupAccountResponse =
  | { redirect: string }
  | { status: SetupStatus }
  | { field: "password"; error: string }
  | { error: string };
