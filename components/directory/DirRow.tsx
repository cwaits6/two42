"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { formatPhone } from "@/lib/sanitize";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface DirRowProps {
  /** Renders a Link when set; otherwise a button when onClick is set, else a plain div */
  href?: string;
  onClick?: () => void;
  avatar: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Chips or a note on their own line under the text, so they never squeeze the name */
  below?: ReactNode;
  /** Pill or other content between the text and the chevron */
  trailing?: ReactNode;
  /** While the card is under 32rem inside its padding, drop `trailing` under the text instead of squeezing the text beside it */
  stackTrailing?: boolean;
  /** Soft-blue emphasis for the selected item in a two-pane list */
  selected?: boolean;
  /** Selected background without aria-current, for rows whose state a separate control owns */
  highlighted?: boolean;
  /** Soft-blue emphasis for upcoming birthdays / anniversaries */
  highlight?: boolean;
  /** Controls beside the row, each its own tap target, never nested inside the row control */
  actions?: ReactNode;
  /** A selection checkbox before the row in bulk mode */
  leading?: ReactNode;
}

/**
 * Large tappable directory row: avatar, bold title, muted subtitle, chevron.
 * Shared by every directory sub-page list.
 */
export function DirRow({
  href,
  onClick,
  avatar,
  title,
  subtitle,
  below,
  trailing,
  stackTrailing,
  selected,
  highlighted,
  highlight,
  actions,
  leading,
}: DirRowProps) {
  const interactive = !!href || !!onClick;
  const className = cn(
    "w-full flex items-center gap-3 min-h-16 px-3 py-3 sm:gap-4 sm:px-4 rounded-xl border bg-card text-left transition-colors",
    selected || highlighted || highlight ? "bg-brand-warm border-brand-primary/40" : "border-border",
    interactive && "hover:border-brand-primary/60",
    (actions || leading) && "flex-1 min-w-0",
    stackTrailing && "@container flex-wrap gap-y-3",
  );

  const inner = (
    <>
      <span className="shrink-0">{avatar}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold break-words text-foreground">{title}</span>
        {subtitle && (
          <span className="block text-base text-muted-foreground">{subtitle}</span>
        )}
        {below && <span className="mt-1.5 block">{below}</span>}
      </span>
      {stackTrailing && trailing ? (
        // pl-16 lines the stacked content up with the text past the 3rem avatar.
        <span className="order-last basis-full pl-16 @lg:order-none @lg:basis-auto @lg:pl-0">
          {trailing}
        </span>
      ) : (
        trailing
      )}
      {interactive && (
        <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      )}
    </>
  );

  let control: ReactNode;
  if (href) {
    control = (
      <Link href={href} className={className} aria-current={selected ? "true" : undefined}>
        {inner}
      </Link>
    );
  } else if (onClick) {
    control = (
      <button
        type="button"
        onClick={onClick}
        className={className}
        aria-current={selected ? "true" : undefined}
      >
        {inner}
      </button>
    );
  } else {
    control = <div className={className}>{inner}</div>;
  }

  if (!actions && !leading) return control;
  return (
    <div className="flex items-center gap-2">
      {leading}
      {control}
      {actions}
    </div>
  );
}

/** A phone number that never breaks across lines. */
export function PhoneText({ phone }: { phone: string }) {
  return <span className="whitespace-nowrap">{formatPhone(phone)}</span>;
}

/** A labelled run of rows (an A–Z letter, a month), spaced clear of the run above it. */
export function DirSection({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-8 first:mt-0">
      <h2 className="mb-2.5 font-sans text-base font-bold tracking-widest text-muted-foreground">{label}</h2>
      <div className="space-y-2.5">{children}</div>
    </section>
  );
}
