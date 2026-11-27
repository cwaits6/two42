// "not_found" is only for sending a new person: where the church chose to send them doesn't exist or isn't active.
export type RecordsFailure = "unauthorized" | "unreachable" | "not_provider" | "rejected" | "not_found";

/** A request to the church's records failed; carries only the kind, the status and what the key lacks, never the response. */
export class RecordsError extends Error {
  constructor(
    readonly kind: RecordsFailure,
    readonly status?: number,
    /** For "unauthorized": what the key can't view, in the provider's own names, when it can view the rest. */
    readonly missing?: readonly string[],
  ) {
    super(`Church records request failed: ${kind}${status ? ` (${status})` : ""}`);
  }
}
