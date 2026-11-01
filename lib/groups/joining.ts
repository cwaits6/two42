// Pure rules behind the discovery row, the join action and the leader's
// Privacy and joining page. No React, no next/* imports, so every rule
// here is testable without I/O. The database enforces the same rules
// (discoverable_groups() and join_group()); these only decide what the UI
// offers and says.

export const JOIN_POLICIES = ["open", "approval"] as const;
export type JoinPolicy = (typeof JOIN_POLICIES)[number];

/** Anything unrecognised reads as approval: "Request to join", never "Join". */
export function parseJoinPolicy(raw: unknown): JoinPolicy {
  return JOIN_POLICIES.find((policy) => policy === raw) ?? "approval";
}

export type ViewerRole = "leader" | "member" | null;

/** One row of discoverable_groups(), as the discovery surfaces render it. */
export interface DiscoverableGroup {
  id: string;
  name: string;
  /** "Meeting time and place" as the group's leader wrote it. */
  description: string | null;
  member_count: number;
  is_private: boolean;
  join_policy: JoinPolicy;
  viewer_role: ViewerRole;
  request_status: "pending" | null;
}

/**
 * The generated RPC types cannot say a RETURNS TABLE column is nullable, so
 * the raw row is widened here once rather than cast at every use.
 */
export function toDiscoverableGroup(raw: {
  id: string;
  name: string;
  description: string | null;
  member_count: number;
  is_private: boolean;
  join_policy: string;
  viewer_role: string | null;
  request_status: string | null;
}): DiscoverableGroup {
  return {
    id: raw.id,
    name: raw.name,
    description: raw.description,
    member_count: raw.member_count,
    is_private: raw.is_private,
    join_policy: parseJoinPolicy(raw.join_policy),
    viewer_role: raw.viewer_role === "leader" || raw.viewer_role === "member" ? raw.viewer_role : null,
    request_status: raw.request_status === "pending" ? "pending" : null,
  };
}

export type JoinRowState = "leads" | "member" | "private" | "join" | "request" | "requested";

/**
 * What the trailing end of a discovery row shows. Own groups first, then the
 * admin-only private tag; under the open policy a stale pending request
 * never hides the Join button, because joining is what resolves it.
 */
export function joinRowState(row: DiscoverableGroup): JoinRowState {
  if (row.viewer_role === "leader") return "leads";
  if (row.viewer_role === "member") return "member";
  if (row.is_private) return "private";
  if (row.join_policy === "open") return "join";
  if (row.request_status === "pending") return "requested";
  return "request";
}

export const JOIN_POLICY_OPTIONS: { value: JoinPolicy; label: string; description: string }[] = [
  {
    value: "approval",
    label: "Approval required",
    description: "A member asks to join. A leader approves it.",
  },
  {
    value: "open",
    label: "Open",
    description: "Any member who finds the group joins at once.",
  },
];

export function memberCountLabel(count: number): string {
  return `${count} member${count === 1 ? "" : "s"}`;
}

/** The discovery row's second line: member count, then the meeting time when the leader wrote one. */
export function discoveryRowSubtitle(row: Pick<DiscoverableGroup, "member_count" | "description">): string {
  const count = memberCountLabel(row.member_count);
  return row.description ? `${count} · ${row.description}` : count;
}

/**
 * A helper sentence with one slot the UI renders as a link to the group's
 * Invite links page. `link` is null when the sentence has no slot.
 */
export interface HelperSentence {
  before: string;
  link: string | null;
  after: string;
}

export const INVITE_LINK_WORDS = "invite link";

export function privacyHelper(orgDiscoveryOn: boolean): HelperSentence {
  return orgDiscoveryOn
    ? {
        before: "Hidden from Find a group and the Directory. People join by ",
        link: INVITE_LINK_WORDS,
        after:
          " or when a leader adds them. Your church's setting is the limit: a private group can only hide more, never less.",
      }
    : {
        before:
          "Already hidden: your church has turned off finding groups. Private keeps this group hidden if that changes.",
        link: null,
        after: "",
      };
}

export function helperSentenceText(sentence: HelperSentence): string {
  return `${sentence.before}${sentence.link ?? ""}${sentence.after}`;
}

export function privacyHelperText(orgDiscoveryOn: boolean): string {
  return helperSentenceText(privacyHelper(orgDiscoveryOn));
}

export const PRIVATE_POLICY_HELPER: HelperSentence = {
  before: "Not used while the group is private. People join by ",
  link: INVITE_LINK_WORDS,
  after: " or when a leader adds them.",
};

export const OPEN_POLICY_EMPTY_TEXT =
  "Requests are approved automatically while anyone can join.";

export const NO_PENDING_TEXT = "No pending requests.";

/** The leader's empty-list sentence; a non-empty list renders whatever the policy. */
export function pendingRequestsEmptyText(policy: JoinPolicy): string {
  return policy === "open" ? OPEN_POLICY_EMPTY_TEXT : NO_PENDING_TEXT;
}

const ERROR_MESSAGES: Record<string, string> = {
  GJ001: "This group isn't open to join.",
  GJ002: "Your account can't join groups yet.",
  GJ003: "You're already in this group.",
  GJ004: "That request is no longer pending.",
};

/** Member-facing copy for a join_group() error code. */
export function joinErrorMessage(code: string | undefined): string {
  return (code && ERROR_MESSAGES[code]) || "Couldn't update your membership. Please try again.";
}

const REVIEW_ERROR_MESSAGES: Record<string, string> = {
  GJ002: "That person's account isn't active, so they can't be added.",
  GJ004: ERROR_MESSAGES.GJ004,
};

/** Leader-facing copy for a review_group_join_request() error code. */
export function reviewErrorMessage(code: string | undefined): string {
  return (code && REVIEW_ERROR_MESSAGES[code]) || "Couldn't update the request. Please try again.";
}
