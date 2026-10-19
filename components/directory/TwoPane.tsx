"use client";

import type { ReactNode } from "react";

interface TwoPaneProps {
  list: ReactNode;
  /** The open detail panel; null shows the placeholder on wide screens. */
  panel: ReactNode | null;
  placeholder: string;
  /** Rendered above the list and hidden with it while a panel is open on a phone. */
  above?: ReactNode;
}

/**
 * List on the left, detail on the right. On a phone the panel replaces the
 * list, so the list, its search box and the panel are never both visible.
 */
export function TwoPane({ list, panel, placeholder, above }: TwoPaneProps) {
  const listClass = panel ? "hidden lg:block" : "";
  return (
    <>
      {above && <div className={listClass}>{above}</div>}
      <div className="grid gap-7 lg:grid-cols-[380px_1fr] lg:items-start">
        <div className={listClass}>{list}</div>
        <div className={panel ? "" : "hidden lg:block"}>
          {panel ? (
            <div className="rounded-xl border border-border bg-card p-6 md:p-7">{panel}</div>
          ) : (
            <div className="rounded-xl border border-dashed border-border p-10 text-center">
              <p className="text-base text-muted-foreground">{placeholder}</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/** Bring a freshly opened panel into view: on a phone it replaces the list. */
export function scrollToPanel() {
  window.scrollTo({ top: 0 });
}
