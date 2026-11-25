import { NextResponse } from "next/server";

/**
 * The answer for a refusal the dinner club migration raises, by its SQLSTATE,
 * or null for any other failure, which the caller logs as a server error.
 */
export function dinnerClubRefusal(error: { code?: string }): NextResponse | null {
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
      return null;
  }
}

export function serverError(): NextResponse {
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

/** An ISO instant from a request body, or null. */
export function instantFrom(body: unknown): string | null {
  const value = (body as { startsAt?: unknown } | null)?.startsAt;
  if (typeof value !== "string") return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}
