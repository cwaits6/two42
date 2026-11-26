// Answers shared by the church admin's church records routes.
import { NextResponse } from "next/server";
import { loadRecordsSecret } from "./crypto";
import type { RecordsError } from "./errors";

/**
 * The records secret, or null while the integration is off. Without
 * RECORDS_KEY_SECRET in the environment every church records route answers
 * 404 before any check, so the setting doesn't exist for any church.
 */
export function recordsSecretOrNull(): Buffer | null {
  return loadRecordsSecret();
}

export function hidden() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

export function gateError(status: 401 | 403) {
  return NextResponse.json({ error: status === 401 ? "Unauthorized" : "Forbidden" }, { status });
}

/** What a church admin is told when the records can't be used, without the provider's own response. */
export function recordsFailureMessage(error: RecordsError, product: string): string {
  switch (error.kind) {
    case "unauthorized":
      return `${product} didn't accept the key. Check it is active and its user can view everything the key instructions list.`;
    case "unreachable":
      return `Couldn't reach ${product} at that address. Check the address and try again.`;
    case "not_provider":
      return `That address didn't answer like ${product}. Check the address.`;
    case "rejected":
      return `${product} refused the request. Try again, or check the key's permissions.`;
  }
}

export function recordsFailure(error: RecordsError, product: string, status = 502) {
  return NextResponse.json({ error: recordsFailureMessage(error, product) }, { status });
}
