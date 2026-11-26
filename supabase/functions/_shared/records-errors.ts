export type RecordsFailure = "unauthorized" | "unreachable" | "not_provider" | "rejected";

/** A request to the church's records failed; carries only the kind and status, never the response. */
export class RecordsError extends Error {
  constructor(
    readonly kind: RecordsFailure,
    readonly status?: number,
  ) {
    super(`Church records request failed: ${kind}${status ? ` (${status})` : ""}`);
  }
}
