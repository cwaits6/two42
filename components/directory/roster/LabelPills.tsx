import type { RosterLabel } from "@/components/directory/useGroupRoster";

/** The labels on a membership: a colour dot plus the name, the name always in text. */
export function LabelPills({ labels }: { labels: RosterLabel[] }) {
  if (labels.length === 0) return null;
  return (
    <span className="flex shrink-0 flex-wrap justify-end gap-1.5">
      {labels.map((label) => (
        <span
          key={label.id}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-0.5 text-base font-medium text-foreground"
        >
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: label.color ?? "var(--color-brand-neutral)" }}
            aria-hidden="true"
          />
          {label.name}
        </span>
      ))}
    </span>
  );
}
