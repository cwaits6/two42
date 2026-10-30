import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/** A back link names the page it returns to, so href and label travel together. */
type BackLink =
  | {
      backHref: string;
      /** "Back to {parent page name}", e.g. "Back to Group settings" */
      backLabel: string;
    }
  | { backHref?: undefined; backLabel?: undefined };

type PageHeaderProps = BackLink & {
  title: React.ReactNode;
  /** Plain, functional copy — one line describing what the page does */
  subtitle?: React.ReactNode;
  /** The page's primary action: right of the title on desktop, full width below the subtitle on phone */
  actions?: React.ReactNode;
  className?: string;
};

/**
 * Canonical page heading: back link above the title (44px target), one H1
 * type ramp, optional subtitle and primary action.
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
          {backLabel}
        </Link>
      )}
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
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
          <div
            data-slot="page-header-actions"
            className="flex flex-col gap-3 *:w-full md:shrink-0 md:flex-row md:items-center md:*:w-auto"
          >
            {actions}
          </div>
        )}
      </div>
    </header>
  );
}
