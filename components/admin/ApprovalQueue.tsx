"use client";

import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export interface ApprovalQueueRow {
  id: string;
  title: string;
  subtitle?: string;
  meta?: string;
}

interface ApprovalQueueProps {
  rows: ApprovalQueueRow[];
  onApprove: (id: string) => void;
  onDecline: (id: string) => void;
  /** The row whose action is in flight; both of its buttons are disabled. */
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
    return <p className="text-lg text-muted-foreground">{emptyText}</p>;
  }

  return (
    <div className="space-y-4">
      {rows.map((row) => (
        <Card key={row.id}>
          <CardContent className="pt-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xl font-semibold">{row.title}</p>
                {row.subtitle && <p className="text-base text-muted-foreground">{row.subtitle}</p>}
                {row.meta && <p className="text-sm text-muted-foreground mt-1">{row.meta}</p>}
              </div>
              <div className="flex gap-2 shrink-0">
                <Button
                  size="lg"
                  className="bg-brand-primary hover:bg-brand-primary/90 text-lg"
                  disabled={busyId === row.id}
                  onClick={() => onApprove(row.id)}
                >
                  <Check className="mr-1 h-5 w-5" aria-hidden="true" />
                  {approveLabel}
                </Button>
                <Button
                  size="lg"
                  variant="destructive"
                  className="text-lg"
                  disabled={busyId === row.id}
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
