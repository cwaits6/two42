// Every failed request a person sees goes through here, so the copy follows
// one rule — "Couldn't {verb} {thing}." and what to do next — and no
// Postgres, PostgREST, Auth or API error text ever reaches a toast or alert.

export const NETWORK_ERROR = "Couldn't reach the server. Check your connection and try again.";

const NEXT_STEP: Partial<Record<number, string>> = {
  401: "Sign in again, then try again.",
  403: "You don't have permission to do that.",
  429: "Wait a minute, then try again.",
};

/**
 * `action` is the verb and thing, e.g. "save the fund". `failure` is the
 * response status, or "network" when the request never got an answer.
 * `known` gives a whole sentence for a status the caller's route uses with a
 * meaning of its own (a 409 that means someone else got there first).
 */
export function failureMessage(
  action: string,
  failure?: number | "network",
  known?: Partial<Record<number, string>>
): string {
  if (failure === "network") return `Couldn't ${action}. Check your connection and try again.`;
  const exact = failure === undefined ? undefined : known?.[failure];
  if (exact) return exact;
  const next = (failure !== undefined && NEXT_STEP[failure]) || "Try again.";
  return `Couldn't ${action}. ${next}`;
}

// The platform API answers 400 and 409 with a sentence written for the
// operator to act on. Anything else (auth, a server failure) gets the
// caller's fixed copy, so no internal error text reaches a toast.
export function operatorMessage(
  status: number,
  data: { error?: unknown } | null,
  fallback: string
): string {
  if ((status === 400 || status === 409) && typeof data?.error === "string" && data.error) {
    return data.error;
  }
  return fallback;
}
