// Answers shared by the church admin's Rock routes.
import { NextResponse } from "next/server";
import { RockError } from "./client";
import { loadRockSecret } from "./crypto";

/**
 * The Rock secret, or null while the integration is off. Without
 * ROCK_KEY_SECRET in the environment every Rock route answers 404 before any
 * check, so the setting doesn't exist for any church.
 */
export function rockSecretOrNull(): Buffer | null {
  return loadRockSecret();
}

export function hidden() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

export function gateError(status: 401 | 403) {
  return NextResponse.json({ error: status === 401 ? "Unauthorized" : "Forbidden" }, { status });
}

/** What a church admin is told when Rock can't be used, without Rock's own response. */
export function rockFailureMessage(error: RockError): string {
  switch (error.kind) {
    case "unauthorized":
      return "Rock didn't accept the key. Check it is active and its user can view people.";
    case "unreachable":
      return "Couldn't reach Rock at that address. Check the address and try again.";
    case "not_rock":
      return "That address didn't answer like Rock. Check the address.";
    case "rejected":
      return "Rock refused the request. Try again, or check the key's permissions.";
  }
}

export function rockFailure(error: RockError, status = 502) {
  return NextResponse.json({ error: rockFailureMessage(error) }, { status });
}
