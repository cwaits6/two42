import { SegmentedLinks } from "@/components/ui/segmented";
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

/** Pages by how often they were opened, and by how often they showed an error. */
export function UsageLists({ rows, days }: { rows: UsageTotal[]; days: UsagePeriod }) {
  const { views, errors } = rankUsage(rows);
  return (
    <>
      <RankedList title="Most opened pages" rows={views} empty={`No pages opened in the last ${days} days.`} />
      <RankedList title="Pages with errors" rows={errors} empty={`No errors in the last ${days} days.`} />
    </>
  );
}
