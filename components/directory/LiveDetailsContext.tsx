"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { NETWORK_ERROR } from "@/lib/errorCopy";
import { logError } from "@/lib/log";
import { LIVE_UNAVAILABLE, type HideableField, type LiveDirectory, type LiveDirectoryOn, type LiveSlot } from "@/lib/integrations/records/livePlan";

export interface LiveControls {
  live: LiveDirectoryOn;
  /** Hides one of the viewer's own details from the directory, or shows it again. */
  hide: (field: HideableField, hidden: boolean) => Promise<void>;
  busy: boolean;
}

const LiveDetailsContext = createContext<LiveControls | null>(null);

/** The live details around a card, or null where the directory shows none: outside it, or for a church that doesn't. */
export function useLiveControls(): LiveControls | null {
  return useContext(LiveDetailsContext);
}

export function LiveDetailsProvider({ value, children }: { value: LiveControls | null; children: ReactNode }) {
  return <LiveDetailsContext.Provider value={value}>{children}</LiveDetailsContext.Provider>;
}

/**
 * Loads the live details once per directory, as one request, only when the
 * church shows details live. Never cached: the browser is asked not to keep
 * them, and the route answers no-store. A failed request reads as unavailable,
 * never as a church with nothing live, so no detail looks absent when it isn't.
 */
export function useLiveDirectory(enabled: boolean) {
  const [live, setLive] = useState<LiveDirectory | null>(null);
  const [generation, setGeneration] = useState(0);
  const [busy, setBusy] = useState(false);
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetch("/api/directory/live", { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<LiveDirectory>) : LIVE_UNAVAILABLE))
      .then((body) => {
        if (!cancelled) setLive(body);
      })
      .catch((err) => {
        logError("Directory live details load failed", err, { route: "/directory" });
        if (!cancelled) setLive(LIVE_UNAVAILABLE);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, generation]);

  const reload = useCallback(() => setGeneration((n) => n + 1), []);

  const hide = useCallback(
    async (field: HideableField, hidden: boolean) => {
      setBusy(true);
      try {
        const { error } = await supabase.rpc("records_live_hide", { _field: field, _hidden: hidden });
        if (error) {
          logError("Directory live detail hide failed", error, { route: "/directory", step: field });
          toast.error(hidden ? "Couldn't hide that. Try again." : "Couldn't show that again. Try again.");
          return;
        }
        reload();
      } catch (err) {
        logError("Directory live detail hide failed", err, { route: "/directory", step: field });
        toast.error(NETWORK_ERROR);
      } finally {
        setBusy(false);
      }
    },
    [supabase, reload],
  );

  const controls = useMemo<LiveControls | null>(
    () => (live?.mode === "live" ? { live, hide, busy } : null),
    [live, hide, busy],
  );
  return { live: enabled ? live : null, controls: enabled ? controls : null, reload };
}

export const isUnavailable = (slot: LiveSlot<unknown> | undefined) => slot?.state === "unavailable";

/** What a detail from the church's records shows when the records can't be reached. */
export const NOT_AVAILABLE = "Not available right now";

/** On a card, when nothing about its details from the church's records could be read. */
export function LiveUnavailableNote() {
  if (!useLiveControls()?.live.unavailable) return null;
  return (
    <p className="text-base text-muted-foreground" role="status">
      Details from your church&apos;s records: {NOT_AVAILABLE}
    </p>
  );
}

/** The viewer's own detail shown live: hide it from the directory, or show it again. */
export function LiveHideButton({ field, hidden }: { field: HideableField; hidden: boolean }) {
  const controls = useLiveControls();
  if (!controls) return null;
  const label = hidden ? "Show again" : "Don't show";
  return (
    <button
      type="button"
      aria-label={`${label}: ${field}`}
      className="ml-2 inline-flex min-h-11 items-center font-semibold text-brand-primary-text underline underline-offset-4 disabled:opacity-50"
      disabled={controls.busy}
      onClick={() => controls.hide(field, !hidden)}
    >
      {label}
    </button>
  );
}
