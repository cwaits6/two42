import Link from "next/link";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatFundDate, fundPaused, fundRecipientLine, fundStatus } from "@/lib/giving/funds";
import { METHOD_ORDER, PAYMENT_METHODS } from "@/lib/giving/methods";
import { groupPath } from "@/lib/groups/active";
import { displayName } from "@/lib/names";
import type { GivingFund, GivingFundMethod } from "@/lib/types";

export type HiddenFundRow = GivingFund & {
  steward: {
    first_name: string | null;
    last_name: string | null;
    preferred_name: string | null;
  } | null;
};

/** The funds this person can edit that members do not see on the Give page. */
export function HiddenFunds({
  groupId,
  funds,
  methods: methodRows,
  today,
}: {
  groupId: string;
  funds: HiddenFundRow[];
  methods: Pick<GivingFundMethod, "fund_id" | "method">[];
  today: string;
}) {
  if (funds.length === 0) return null;
  return (
    <section aria-labelledby="hidden-funds" className="mt-10">
      <h2 id="hidden-funds" className="mb-4 font-serif text-2xl font-medium text-foreground">
        Hidden from members
      </h2>
      <div className="space-y-3">
        {funds.map((fund) => {
          const status = fundStatus(fund, today);
          const methods = METHOD_ORDER.filter((key) =>
            methodRows.some((m) => m.fund_id === fund.id && m.method === key)
          );
          return (
            <div
              key={fund.id}
              className="flex flex-col gap-3 rounded-2xl border border-border bg-card px-5 py-4 sm:flex-row sm:items-center sm:gap-4"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-lg font-semibold text-foreground">{fund.name}</span>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-sm font-semibold ${
                      status.live
                        ? "bg-brand-warm text-brand-primary-text"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {status.text}
                  </span>
                </div>
                <p className="mt-1 text-base text-muted-foreground">
                  {fund.steward
                    ? fundRecipientLine(displayName(fund.steward), fund.steward_role)
                    : "No one named to receive it"}
                </p>
                {fund.retire_on && status.live && (
                  <p className="text-base text-muted-foreground">
                    Retires {formatFundDate(fund.retire_on)}
                  </p>
                )}
                <p className="text-base text-muted-foreground">
                  {methods.length > 0
                    ? methods.map((key) => PAYMENT_METHODS[key].name).join(", ")
                    : "No payment methods"}
                </p>
              </div>
              <Button
                variant="outline"
                nativeButton={false}
                render={<Link href={groupPath(groupId, `/give/${fund.id}/edit`)} />}
                aria-label={`${fundPaused(fund) ? "Review" : "Edit"} ${fund.name}`}
              >
                <Pencil aria-hidden="true" />
                {fundPaused(fund) ? "Review" : "Edit"}
              </Button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
