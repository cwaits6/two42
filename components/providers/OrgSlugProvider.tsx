"use client";

import { createContext, useContext } from "react";

const OrgSlugContext = createContext<string | null>(null);

/**
 * Phase 5 PR 3 (CWA-67 / #360). Makes the host-resolved org slug
 * (x-two42-resolved-org, falling back to the env pin — the same value
 * lib/supabase/server.ts's createClient() defaults to) available to
 * client components without re-deriving it from window.location, which
 * cannot work for custom domains and would create a second,
 * potentially-divergent resolution path (docs/plans/
 * phase-5-domains-email.md §5.4 — inject the server-resolved slug; do
 * not re-derive it client-side).
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
