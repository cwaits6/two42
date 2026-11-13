import { SegmentedLinks } from "@/components/ui/segmented";
import { USAGE_KINDS, type UsageKind } from "@/lib/analytics/recordUsage";
import { rankUsage, USAGE_PERIODS, type RankedUsage, type UsagePeriod, type UsageTotal } from "@/lib/analytics/usage";

/** Last 7, 30 or 90 days, kept in the page's `days` query. */
export function UsagePeriodLinks({ path, days }: { path: string; days: UsagePeriod }) {
  return (
    <SegmentedLinks
      label="Period"
      className="mb-8"
      options={USAGE_PERIODS.map((period) => ({
        href: `${path}?days=${period}`,
        label: `Last ${period} days`,
        current: period === days,
      }))}
    />
  );
}

function RankedList({ title, rows, empty }: { title: string; rows: RankedUsage[]; empty: string }) {
  return (
    <section className="mb-10">
      <h2 className="mb-3 text-xl font-bold text-foreground">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-lg text-muted-foreground">{empty}</p>
      ) : (
        <ol className="divide-y divide-border rounded-2xl border border-border bg-card">
          {rows.map((row) => (
            <li key={row.pattern} className="flex min-h-11 items-start justify-between gap-4 px-5 py-3">
              <span className="min-w-0 break-all font-mono text-base text-foreground">{row.pattern}</span>
              <span className="shrink-0 text-right text-lg font-semibold text-foreground">{row.shown}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

const LIST_COPY: Record<UsageKind, { title: string; empty: (days: UsagePeriod) => string }> = {
  view: { title: "Most opened pages", empty: (days) => `No pages opened in the last ${days} days.` },
  error: { title: "Pages with errors", empty: (days) => `No errors in the last ${days} days.` },
};

/** Pages by how often they were opened, and by how often they showed an error. */
export function UsageLists({ rows, days }: { rows: UsageTotal[]; days: UsagePeriod }) {
  const ranked = rankUsage(rows);
  return (
    <>
      {USAGE_KINDS.map((kind) => (
        <RankedList key={kind} title={LIST_COPY[kind].title} rows={ranked[kind]} empty={LIST_COPY[kind].empty(days)} />
      ))}
    </>
  );
}
