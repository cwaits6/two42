"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { toDiscoverableGroup, type DiscoverableGroup } from "@/lib/groups/joining";

/**
 * The viewer's discovery rows from discoverable_groups(). Seeded with the
 * server's rows when the page already loaded them, so the first paint has
 * no spinner; reload() re-reads after a join or request.
 */
export function useDiscoverableGroups(initialRows?: DiscoverableGroup[]) {
  const [rows, setRows] = useState<DiscoverableGroup[]>(initialRows ?? []);
  const [loading, setLoading] = useState(initialRows === undefined);
  const [error, setError] = useState(false);
  const [generation, setGeneration] = useState(0);
  // The seed stands in for the first read; every later read is a reload.
  const seeded = useRef(initialRows !== undefined);
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    if (seeded.current) {
      seeded.current = false;
      return;
    }
    let cancelled = false;
    setLoading(true);
    supabase.rpc("discoverable_groups").then(({ data, error: rpcError }) => {
      if (cancelled) return;
      if (rpcError) {
        console.error("Failed to load discoverable groups:", rpcError);
        setError(true);
        setLoading(false);
        return;
      }
      setRows((data ?? []).map(toDiscoverableGroup));
      setError(false);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [supabase, generation]);

  const reload = useCallback(() => setGeneration((n) => n + 1), []);

  return { rows, loading, error, reload };
}
