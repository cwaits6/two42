import { cache } from "react";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

export type CurrentUser = { id: string; email: string | undefined };

// Resolve the authenticated user for a server render, or null when anonymous.
// Skips the auth call entirely when there are no auth cookies, so anonymous
// visitors don't trigger "Invalid Refresh Token" lookups.
//
// getClaims() verifies the JWT locally against the cached signing keys, so a
// session revoked server-side still reads as signed in until the JWT expires;
// route handlers that write keep getUser() for that server-side check.
export const getOptionalUser = cache(async (): Promise<CurrentUser | null> => {
  const cookieStore = await cookies();
  const hasAuthCookie = cookieStore
    .getAll()
    .some((c) => c.name.includes("auth-token"));
  if (!hasAuthCookie) return null;

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;
  return { id: claims.sub, email: claims.email };
});
