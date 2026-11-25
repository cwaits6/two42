import { NextResponse } from "next/server";
import { logError } from "@/lib/log";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string | null | undefined): value is string {
  return Boolean(value && UUID.test(value));
}

/** The answer for a database refusal, by the SQLSTATEs the dinner club migration raises. */
export function dinnerClubFailure(error: { code?: string }, route: string, what: string): NextResponse {
  switch (error.code) {
    case "DC001":
    case "42501":
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    case "DC002":
      return NextResponse.json({ error: "Check the tables and try again." }, { status: 400 });
    case "DC003":
      return NextResponse.json({ error: "The season has changed. Refresh and try again." }, { status: 409 });
    case "DC004":
      return NextResponse.json({ error: "Choose a date and time within the season that hasn't passed." }, { status: 400 });
    default:
      logError(what, error, { route });
      return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}

/** An ISO instant from a request body, or null. */
export function instantFrom(body: unknown): string | null {
  const value = (body as { startsAt?: unknown } | null)?.startsAt;
  if (typeof value !== "string") return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}
