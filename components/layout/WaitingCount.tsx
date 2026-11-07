/** A row's waiting number: shown beside the label, and read with it by a screen reader. */
export function WaitingCount({ count, collapsed }: { count: number; collapsed: boolean }) {
  return (
    <>
      {!collapsed && (
        <span
          aria-hidden="true"
          className="ml-auto min-w-7 rounded-full bg-primary px-2 text-center text-sm font-semibold text-primary-foreground"
        >
          {count}
        </span>
      )}
      <span className="sr-only">, {count} waiting</span>
    </>
  );
}
