// Pure rules behind the create / request action and the admin policy
// select. No React, no next/* imports, so every rule here is testable
// without I/O. The database enforces the same rules (group_create() and the
// group_requests INSERT policy); these only decide what the UI offers.

export const GROUP_CREATION_POLICIES = ["open", "approval", "admins"] as const;
export type GroupCreationPolicy = (typeof GROUP_CREATION_POLICIES)[number];

/** Anything unrecognised reads as approval: "Request a group", never "Create a group". */
export function parseGroupCreationPolicy(raw: unknown): GroupCreationPolicy {
  return GROUP_CREATION_POLICIES.find((policy) => policy === raw) ?? "approval";
}

export type CreationAction =
  | { kind: "create"; label: "Create a group" }
  | { kind: "request"; label: "Request a group" };

/** The button a viewer sees, or null when the org leaves creation to its admins. */
export function creationActionFor(
  policy: GroupCreationPolicy,
  isOrgAdmin: boolean
): CreationAction | null {
  if (isOrgAdmin || policy === "open") return { kind: "create", label: "Create a group" };
  if (policy === "approval") return { kind: "request", label: "Request a group" };
  return null;
}

// The same limits the Group settings form enforces on the stored columns.
export const GROUP_NAME_MAX = 120;
export const GROUP_DESCRIPTION_MAX = 1000;

export type Validated<T> = { ok: true; value: T } | { ok: false; reason: string };

export function validateGroupName(raw: string): Validated<string> {
  const value = raw.trim();
  if (!value) return { ok: false, reason: "Enter a group name." };
  if (value.length > GROUP_NAME_MAX) {
    return { ok: false, reason: `Keep the group name to ${GROUP_NAME_MAX} characters.` };
  }
  return { ok: true, value };
}

/** Empty is allowed and stored as null. */
export function validateGroupDescription(raw: string): Validated<string | null> {
  const value = raw.trim();
  if (value.length > GROUP_DESCRIPTION_MAX) {
    return {
      ok: false,
      reason: `Keep the meeting time and place to ${GROUP_DESCRIPTION_MAX} characters.`,
    };
  }
  return { ok: true, value: value || null };
}

export const GROUP_CREATION_POLICY_OPTIONS: {
  value: GroupCreationPolicy;
  label: string;
  description: string;
}[] = [
  {
    value: "open",
    label: "Open",
    description: "Any member can create a group. It goes live at once.",
  },
  {
    value: "approval",
    label: "Approval required",
    description: "A member asks for a group. An org admin approves it.",
  },
  {
    value: "admins",
    label: "Org admins only",
    description: "Only org admins create groups.",
  },
];

const ERROR_MESSAGES: Record<string, string> = {
  GC001: "Your organization does not let members create groups.",
  GC002: "Your account cannot create groups yet.",
  GC003: "That person is not an approved member of your organization.",
  GC004: "That request is no longer waiting for approval.",
  GC005: "Only an org admin can do that.",
  GC006: "Enter a group name.",
  GC007: `Keep the group name to ${GROUP_NAME_MAX} characters and the meeting time and place to ${GROUP_DESCRIPTION_MAX}.`,
};

/** Member-facing copy for a group_create() / group_request_approve() error code. */
export function groupCreationErrorMessage(code: string | undefined): string {
  return (code && ERROR_MESSAGES[code]) || "Couldn't create the group. Please try again.";
}
