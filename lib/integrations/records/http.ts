// Answers shared by the church admin's church records routes.
import { NextResponse } from "next/server";
import { loadRecordsSecret } from "./crypto";
import { RecordsError, type RecordsFailure } from "./errors";
import type { RecordsIntakeSetup } from "./types";

// Rock generates 24-character keys; an admin can type their own.
export const RECORDS_KEY_SHAPE = /^[\x21-\x7e]{8,200}$/;

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
    case "not_found":
      return `${product} didn't find what two42 asked for. Check the address.`;
  }
}

/** What a church admin is told when sending new people fails, naming the write key. */
export function intakeFailureMessage(error: RecordsError, product: string, setup: RecordsIntakeSetup): string {
  switch (error.kind) {
    case "unauthorized":
      return `${product} didn't accept the write key, or its role is missing a permission. Check the key is active and its role has every permission the write key instructions list, including View on the ${setup.destinationLabel}.`;
    case "not_found":
      return `${product} has no active ${setup.destinationLabel} with that id. Choose another, or check it is active in ${product}.`;
    case "unreachable":
      return `Couldn't reach ${product}. Check that ${product} is up and answers at the connected address.`;
    default:
      return recordsFailureMessage(error, product);
  }
}

/** Why the newest send failed, for the card. A saved write key two42 can't open is recorded as unauthorized too, and entering it again fixes that. */
export function intakeLastFailureMessage(kind: RecordsFailure, product: string, setup: RecordsIntakeSetup): string {
  const message = intakeFailureMessage(new RecordsError(kind), product, setup);
  return kind === "unauthorized" ? `${message} If both are right, choose Change and enter the write key again.` : message;
}

export function recordsFailure(error: RecordsError, product: string, status = 502) {
  return NextResponse.json({ error: recordsFailureMessage(error, product) }, { status });
}
