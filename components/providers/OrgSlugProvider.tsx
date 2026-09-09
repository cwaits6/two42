"use client";

import { createContext, useContext } from "react";

const OrgSlugContext = createContext<string | null>(null);

/**
 * Makes the host-resolved org slug
 * (x-two42-resolved-org, falling back to the env pin — the same value
 * lib/supabase/server.ts's createClient() defaults to) available to
 * client components without re-deriving it from window.location, which
 * cannot work for custom domains and would create a second,
 * potentially-divergent resolution path (inject the server-resolved
 * slug; do not re-derive it client-side).
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
