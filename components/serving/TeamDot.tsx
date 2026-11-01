import { cn } from "@/lib/utils";

/** A team's color; a team saved without one gets the neutral token instead of no dot. */
export function TeamDot({ color, className }: { color: string | null; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block h-4 w-4 shrink-0 rounded-full", className)}
      style={{ backgroundColor: color || "var(--color-brand-neutral)" }}
    />
  );
}
