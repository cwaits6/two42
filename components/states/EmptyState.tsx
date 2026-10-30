import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon: LucideIcon;
  /** One line in the page's own terms, e.g. "No events yet" */
  message: string;
  /** The next step, rendered only for people who can take it */
  action?: React.ReactNode;
  className?: string;
}

/** A read that succeeded and found nothing. Never use it for a failed read: that is ErrorState. */
export function EmptyState({ icon: Icon, message, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center rounded-2xl border border-dashed border-border px-6 py-12 text-center",
        className,
      )}
    >
      <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-brand-warm">
        <Icon className="h-7 w-7 text-brand-primary-text" aria-hidden="true" />
      </span>
      <p className="text-xl text-foreground">{message}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
