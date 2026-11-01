"use client";

import { toast } from "sonner";
import { Copy, ExternalLink } from "lucide-react";
import { methodHref, type ResolvedMethod } from "@/lib/giving/methods";

/** Text chip for a payment method (no trademarked logos) */
export function MethodChip({
  method,
  size = "md",
}: {
  method: ResolvedMethod["meta"];
  size?: "sm" | "md";
}) {
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-lg bg-brand-warm font-bold text-brand-primary-text ${
        size === "sm" ? "h-7 w-7 text-sm" : "h-10 w-10 text-lg"
      }`}
    >
      {method.glyph}
    </span>
  );
}

/**
 * One payment option. Link methods (Venmo/PayPal/Cash App) open the payer's
 * own app in a new tab; copy methods (Zelle, Apple/Google Pay) copy the
 * account to the clipboard since they have no public profile URLs.
 */
export function MethodButton({ resolved }: { resolved: ResolvedMethod }) {
  const { meta, handle } = resolved;
  // Don't double the prefix when the stored handle already includes it
  const displayHandle =
    meta.prefix && handle.toLowerCase().startsWith(meta.prefix.toLowerCase())
      ? handle.slice(meta.prefix.length)
      : handle;
  const details = (
    <>
      <span className="block text-base font-semibold text-foreground">{meta.name}</span>
      <span className="block break-words text-base text-muted-foreground">
        {meta.prefix}
        {displayHandle}
      </span>
    </>
  );
  const action = "mt-1 flex items-center gap-1.5 text-base font-semibold text-brand-primary-text";
  const frame =
    "flex min-h-11 w-full items-start gap-3.5 rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:border-brand-primary/50";

  if (meta.kind === "link") {
    return (
      <a
        href={methodHref(meta.key, handle)}
        target="_blank"
        rel="noopener noreferrer"
        className={frame}
      >
        <MethodChip method={meta} />
        <span className="min-w-0 flex-1 text-left">
          {details}
          <span className={action}>
            {meta.verb}
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
          </span>
        </span>
      </a>
    );
  }

  return (
    <button
      type="button"
      className={frame}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(handle);
          toast.success(`Copied ${handle}`, {
            description: `Paste it in ${meta.name} to send.`,
          });
        } catch {
          toast.error(`Couldn't copy ${handle}. Enter it in ${meta.name} yourself.`);
        }
      }}
    >
      <MethodChip method={meta} />
      <span className="min-w-0 flex-1 text-left">
        {details}
        <span className={action}>
          <Copy className="h-4 w-4" aria-hidden="true" />
          Copy
        </span>
      </span>
    </button>
  );
}
