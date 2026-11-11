import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import type { AccessRequestStatus } from "@/lib/types";
import { SETUP_STATUS, type SetupAccountResponse } from "./setup-response";

const MAX_TOKEN_LENGTH = 512;
const USER_ID_PREFIX = "two42:setup-account:";

/** The token from a setup request body, or null for anything that cannot be one. */
export function readSetupToken(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const token = (body as { token?: unknown }).token;
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    return null;
  }
  return token;
}

/**
 * The id of the account a setup link creates. Consuming the link erases its
 * token, so the account under this id is what marks the link as used, and a
 * retry of the same link can never create a second account.
 */
export function setupUserId(token: string): string {
  const bytes = createHash("sha256").update(USER_ID_PREFIX + token).digest().subarray(0, 16);
  // RFC 9562 version 8 (custom) with the standard variant bits.
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export type SetupAccount =
  | { kind: "none" }
  | { kind: "found"; email: string | null }
  | { kind: "error"; error: unknown };

/** The account this setup link created, if any. */
export async function findSetupAccount(
  admin: SupabaseClient["auth"]["admin"],
  token: string,
): Promise<SetupAccount> {
  const { data, error } = await admin.getUserById(setupUserId(token));
  if (error) {
    return error.status === 404 || error.code === "user_not_found"
      ? { kind: "none" }
      : { kind: "error", error };
  }
  return data.user ? { kind: "found", email: data.user.email ?? null } : { kind: "none" };
}

/** The only status a setup link's access request may have for the link to work. */
export const SETUP_LINK_STATUS = "approved" satisfies AccessRequestStatus;

type SetupRowFields = { org_id: string | null; token_expires_at: string | null };

export type SetupRowState<T> =
  | { state: "live"; row: T & { org_id: string } }
  | { state: "unknown" }
  | { state: "expired" };

/**
 * Whether the row a setup link resolved to still works. The form check and the
 * account creation both decide through this, so a link the form shows can
 * always be set up and one it calls dead never can.
 */
export function classifySetupRow<T extends SetupRowFields>(
  row: T | null,
  now: Date = new Date(),
): SetupRowState<T> {
  if (!row || !row.org_id) return { state: "unknown" };
  if (row.token_expires_at && new Date(row.token_expires_at) < now) return { state: "expired" };
  return { state: "live", row: { ...row, org_id: row.org_id } };
}

export const INVALID_LINK = { error: "Invalid or expired token" } as const;

export const setUpResponse = () =>
  NextResponse.json<SetupAccountResponse>({ status: SETUP_STATUS.setUp }, { status: 409 });
export const accountExistsResponse = () =>
  NextResponse.json<SetupAccountResponse>({ status: SETUP_STATUS.accountExists }, { status: 409 });

/**
 * The answer for a setup link with no live row: "already set up" when this
 * link created an account, otherwise unknown (404) or expired (410). A failed
 * account lookup takes the invalid answer, never a guess.
 */
export async function deadLinkResponse(
  admin: SupabaseClient["auth"]["admin"],
  token: string,
  expired: boolean,
  logLookupFailure: (error: unknown) => void,
): Promise<NextResponse> {
  const account = await findSetupAccount(admin, token);
  if (account.kind === "found") {
    return setUpResponse();
  }
  if (account.kind === "error") {
    logLookupFailure(account.error);
  }
  return expired
    ? NextResponse.json({ error: "Token has expired" }, { status: 410 })
    : NextResponse.json(INVALID_LINK, { status: 404 });
}
