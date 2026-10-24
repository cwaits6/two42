// Pure rules behind group invite links: when a link is live, how the create
// dialog's presets become column values, the URL a leader copies, and the
// copy both join paths show. No React, no next/* imports, so every rule
// here is testable without I/O. The database enforces the same liveness
// rules inside group_invite_redeem() and group_invite_join(); these only
// decide what the UI offers and says.

export type GroupInviteStatus = "active" | "revoked" | "expired" | "used_up";

export interface GroupInviteLiveness {
  revoked_at: string | null;
  expires_at: string | null;
  max_uses: number | null;
}

/** Precedence: revoked beats expired beats used up. */
export function inviteStatus(
  row: GroupInviteLiveness,
  uses: number,
  now: Date,
): GroupInviteStatus {
  if (row.revoked_at !== null) return "revoked";
  if (row.expires_at !== null && new Date(row.expires_at).getTime() <= now.getTime()) {
    return "expired";
  }
  if (row.max_uses !== null && uses >= row.max_uses) return "used_up";
  return "active";
}

export const INVITE_STATUS_LABELS: Record<GroupInviteStatus, string> = {
  active: "Active",
  revoked: "Revoked",
  expired: "Expired",
  used_up: "Used up",
};

export function inviteUrl(siteUrl: string, token: string): string {
  return `${siteUrl.replace(/\/+$/, "")}/join/${token}`;
}

export const EXPIRY_PRESETS = [
  { value: "never", label: "Never", days: null },
  { value: "7d", label: "7 days", days: 7 },
  { value: "30d", label: "30 days", days: 30 },
] as const;
export type ExpiryPreset = (typeof EXPIRY_PRESETS)[number]["value"];
export const DEFAULT_EXPIRY_PRESET: ExpiryPreset = "never";

export function parseExpiryPreset(raw: unknown): ExpiryPreset {
  return EXPIRY_PRESETS.find((p) => p.value === raw)?.value ?? DEFAULT_EXPIRY_PRESET;
}

/** ISO timestamp for expires_at, or null for a link that never expires. */
export function expiresAtFromPreset(preset: ExpiryPreset, now: Date): string | null {
  const days = EXPIRY_PRESETS.find((p) => p.value === preset)?.days ?? null;
  if (days === null) return null;
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

export const USE_PRESETS = [
  { value: "unlimited", label: "No limit", maxUses: null },
  { value: "1", label: "1 person", maxUses: 1 },
  { value: "10", label: "10 people", maxUses: 10 },
] as const;
export type UsePreset = (typeof USE_PRESETS)[number]["value"];
export const DEFAULT_USE_PRESET: UsePreset = "unlimited";

export function parseUsePreset(raw: unknown): UsePreset {
  return USE_PRESETS.find((p) => p.value === raw)?.value ?? DEFAULT_USE_PRESET;
}

export function maxUsesFromPreset(preset: UsePreset): number | null {
  return USE_PRESETS.find((p) => p.value === preset)?.maxUses ?? null;
}

export function usesLabel(uses: number, maxUses: number | null): string {
  if (maxUses !== null) return `Used ${uses} of ${maxUses}`;
  return `Used ${uses} time${uses === 1 ? "" : "s"}`;
}

export function expiryLabel(expiresAt: string | null, timeZone: string): string {
  if (expiresAt === null) return "Never expires";
  const date = new Date(expiresAt).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone,
  });
  return `Expires ${date}`;
}

/** One message for every dead state, so the page never says which. */
export const INVITE_INVALID_TEXT =
  "This invite link is no longer valid. Ask the group leader for a new one.";

export const INVITE_OTHER_ORG_TEXT = "This invite is for a different organization.";

const JOIN_ERROR_MESSAGES: Record<string, string> = {
  GI001: INVITE_INVALID_TEXT,
  GI006: INVITE_OTHER_ORG_TEXT,
};

/** Member-facing copy for a group_invite_join() error code. */
export function inviteJoinErrorMessage(code: string | undefined): string {
  return (code && JOIN_ERROR_MESSAGES[code]) || "Couldn't join the group. Please try again.";
}
