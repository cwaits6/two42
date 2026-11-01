"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type ClickFacts = {
  button: number;
  modified: boolean;
  defaultPrevented: boolean;
  /** The clicked link's resolved href, or null when the click was not on a link. */
  href: string | null;
  target: string | null;
  download: boolean;
};

/** Where a click would navigate this tab away to, or null when it stays on the page. */
export function leavingHref(click: ClickFacts, currentHref: string): string | null {
  if (click.button !== 0 || click.modified || click.defaultPrevented) return null;
  if (click.href === null || click.download) return null;
  if (click.target && click.target !== "_self") return null;
  const to = new URL(click.href, currentHref);
  const from = new URL(currentHref);
  if (to.protocol !== "http:" && to.protocol !== "https:") return null;
  if (to.origin === from.origin && to.pathname === from.pathname && to.search === from.search) {
    return null;
  }
  return to.href;
}

// Long enough for a real traversal to start; a page that has left never reads it.
const BACK_SETTLE_MS = 1000;

type Leaving = { kind: "link"; href: string; sameOrigin: boolean } | { kind: "back" };

/**
 * Holds a navigation away while `dirty`, for the page to ask about. Client
 * navigation has no cancellable event, so each way out is caught separately:
 * links in the capture phase before the router's handler sees them, Back and
 * Forward through a spare history entry, and a reload or closed tab through
 * beforeunload.
 */
export function useLeaveGuard(dirty: boolean) {
  const router = useRouter();
  const [leaving, setLeaving] = useState<Leaving | null>(null);
  const hasSpareEntry = useRef(false);
  const released = useRef(false);

  // A Save finishing while the question is open leaves nothing to ask about.
  if (!dirty && leaving) setLeaving(null);

  useEffect(() => {
    if (!dirty) {
      if (hasSpareEntry.current) {
        hasSpareEntry.current = false;
        window.history.back();
      }
      return;
    }

    if (!hasSpareEntry.current) {
      window.history.pushState(window.history.state, "", window.location.href);
      hasSpareEntry.current = true;
    }

    const onClick = (event: MouseEvent) => {
      if (released.current || !(event.target instanceof Element)) return;
      const link = event.target.closest<HTMLAnchorElement>("a[href]");
      const href = leavingHref(
        {
          button: event.button,
          modified: event.metaKey || event.ctrlKey || event.shiftKey || event.altKey,
          defaultPrevented: event.defaultPrevented,
          href: link?.href ?? null,
          target: link?.getAttribute("target") ?? null,
          download: link?.hasAttribute("download") ?? false,
        },
        window.location.href,
      );
      if (href === null) return;
      event.preventDefault();
      event.stopPropagation();
      setLeaving({
        kind: "link",
        href,
        sameOrigin: new URL(href).origin === window.location.origin,
      });
    };

    const onPopState = () => {
      if (released.current) return;
      window.history.pushState(window.history.state, "", window.location.href);
      setLeaving({ kind: "back" });
    };

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (released.current) return;
      event.preventDefault();
    };

    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", onPopState);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [dirty]);

  function leave() {
    const target = leaving;
    released.current = true;
    setLeaving(null);
    if (target?.kind === "back") {
      // One step off the spare entry, one more to where Back was going.
      window.history.go(-2);
      // With no earlier entry go() does nothing and reports nothing, and the
      // page stays open and unsaved, so it has to keep asking.
      window.setTimeout(() => {
        released.current = false;
      }, BACK_SETTLE_MS);
    } else if (target?.sameOrigin) {
      router.push(target.href);
    } else if (target) {
      window.location.assign(target.href);
    }
  }

  return { asking: leaving !== null, stay: () => setLeaving(null), leave };
}
