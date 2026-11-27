"use client";

import { type LabelField, type ProfileRecords, recordsLabel } from "@/lib/integrations/records/labels";

/** Under a detail from the church's records: where it came from, and the way back to the church's value. */
export function RecordsNote<F extends LabelField>({
  records,
  field,
  onUseChurchValue,
  busy,
}: {
  records: ProfileRecords | null;
  field: F;
  onUseChurchValue: (field: F) => void;
  busy: boolean;
}) {
  const label = recordsLabel(records, field);
  if (!label) return null;
  if (label.kind === "locked") return <p className="text-base font-medium text-muted-foreground">Managed by your church</p>;
  if (label.kind === "records") return <p className="text-base text-muted-foreground">From your church&apos;s records</p>;
  return (
    <p className="flex flex-wrap items-center gap-x-1 text-base text-muted-foreground">
      Changed in two42
      {label.churchValue && (
        <>
          <span aria-hidden="true">·</span>
          <button
            type="button"
            className="inline-flex min-h-11 items-center font-semibold text-brand-primary-text underline underline-offset-4 disabled:opacity-50"
            onClick={() => onUseChurchValue(field)}
            disabled={busy}
          >
            Use your church&apos;s value
          </button>
        </>
      )}
    </p>
  );
}

/** A locked detail, shown as text: the church manages it and there is nothing to edit. */
export function LockedValue({ id, label, value }: { id: string; label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p id={id} className="text-base font-medium">
        {label}
      </p>
      <p className="text-lg">{value || "Not given"}</p>
      <p className="text-base font-medium text-muted-foreground">Managed by your church</p>
    </div>
  );
}
