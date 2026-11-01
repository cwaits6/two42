"use client";

import { Check, Inbox, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/states/EmptyState";

export interface ApprovalQueueRow {
  id: string;
  title: string;
  subtitle?: string;
  /** The requester's own words. */
  quote?: string;
  meta?: string;
}

interface ApprovalQueueProps {
  rows: ApprovalQueueRow[];
  onApprove: (id: string) => void;
  onDecline: (id: string) => void;
  /**
   * The row whose action is in flight. Every row's buttons stay disabled until
   * it settles: the caller holds one busy id, so a second action started meanwhile
   * would clear the first's and re-enable its row mid-request.
   */
  busyId: string | null;
  emptyText: string;
  approveLabel?: string;
  declineLabel?: string;
}

/** Presentational list of things an admin approves or declines; the caller owns the actions. */
export function ApprovalQueue({
  rows,
  onApprove,
  onDecline,
  busyId,
  emptyText,
  approveLabel = "Approve",
  declineLabel = "Decline",
}: ApprovalQueueProps) {
  if (rows.length === 0) {
    return <EmptyState icon={Inbox} message={emptyText} />;
  }

  return (
    <div className="space-y-4">
      {rows.map((row) => (
        <Card key={row.id}>
          <CardContent>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xl font-semibold">{row.title}</p>
                {row.subtitle && (
                  <p className="break-words text-base text-muted-foreground">{row.subtitle}</p>
                )}
                {row.quote && <p className="mt-2 text-base italic">&ldquo;{row.quote}&rdquo;</p>}
                {row.meta && <p className="text-base text-muted-foreground mt-1">{row.meta}</p>}
              </div>
              <div className="flex gap-2 shrink-0">
                <Button
                  size="lg"
                  className="text-lg"
                  disabled={busyId !== null}
                  onClick={() => onApprove(row.id)}
                >
                  <Check className="mr-1 h-5 w-5" aria-hidden="true" />
                  {approveLabel}
                </Button>
                <Button
                  size="lg"
                  variant="destructive"
                  className="text-lg"
                  disabled={busyId !== null}
                  onClick={() => onDecline(row.id)}
                >
                  <X className="mr-1 h-5 w-5" aria-hidden="true" />
                  {declineLabel}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
