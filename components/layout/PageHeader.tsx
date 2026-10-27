import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: React.ReactNode;
  /** Plain, functional copy — one sentence describing what the page does */
  subtitle?: React.ReactNode;
  /** Right-aligned action buttons */
  actions?: React.ReactNode;
  backHref?: string;
  /** Visible label next to the back arrow, e.g. "Back to Directory" */
  backLabel?: string;
  className?: string;
}

/**
 * Canonical page heading: one H1 type ramp, optional subtitle, optional
 * right-aligned actions, and one back-nav affordance (arrow + visible text
 * label, 44px touch target). Replaces per-page bespoke headers.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  backHref,
  backLabel,
  className,
}: PageHeaderProps) {
  return (
    <header className={cn("mb-8", className)}>
      {backHref && (
        <Link
          href={backHref}
          className="mb-3 inline-flex min-h-11 items-center gap-2 text-base font-semibold text-brand-primary-text underline underline-offset-4 hover:text-foreground"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          {backLabel ?? "Back"}
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-serif text-4xl font-medium tracking-tight text-foreground md:text-5xl">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-3 text-lg leading-relaxed text-muted-foreground">
              {subtitle}
            </p>
          )}
        </div>
        {actions && (
          <div className="flex shrink-0 flex-wrap items-center gap-3">
            {actions}
          </div>
        )}
      </div>
    </header>
  );
}
