"use client";

import { createContext, useContext } from "react";

const OrgSlugContext = createContext<string | null>(null);

/**
 * Makes the server-resolved org slug (the env pin — the same value
 * lib/supabase/server.ts's createClient() defaults to) available to client
 * components, so they never derive one of their own from window.location.
 */
export function OrgSlugProvider({
  orgSlug,
  children,
}: {
  orgSlug: string;
  children: React.ReactNode;
}) {
  return (
    <OrgSlugContext.Provider value={orgSlug}>
      {children}
    </OrgSlugContext.Provider>
  );
}

export function useOrgSlug(): string {
  const ctx = useContext(OrgSlugContext);
  if (ctx === null) {
    throw new Error("useOrgSlug must be used within OrgSlugProvider");
  }
  return ctx;
}
