import Link from "next/link";
import { UtensilsCrossed } from "lucide-react";
import { buttonVariants } from "@/components/ui/button-variants";
import { REPLY_LABELS, supperWhen } from "@/lib/supperClub/labels";
import type { NextSupper } from "@/lib/supperClub/nextSupper";
import { cn } from "@/lib/utils";

const TERM = "font-sans text-base text-muted-foreground";
const VALUE = "font-sans text-lg text-foreground";

/** The viewer's next supper on Home: when, where, and their answer, with the way to the Supper club. */
export function NextSupperCard({ supper, zone, href }: { supper: NextSupper; zone: string; href: string }) {
  const rows: [string, string][] = [
    ["Host", supper.isHost ? "You" : (supper.hostNames ?? "Not chosen yet")],
    ...(supper.address ? ([["Address", supper.address]] as [string, string][]) : []),
    ["Your reply", supper.reply ? REPLY_LABELS[supper.reply] : "No reply yet"],
    ...(supper.bringing ? ([["You're bringing", supper.bringing]] as [string, string][]) : []),
  ];
  return (
    <section aria-labelledby="next-supper" className="rounded-2xl border border-border bg-card p-5">
      <p className="flex items-center gap-2 font-sans text-sm font-semibold text-brand-accent-text">
        <UtensilsCrossed className="h-4 w-4 shrink-0" aria-hidden="true" />
        Your next supper
      </p>
      <h2 id="next-supper" className="mt-1 font-serif text-2xl font-medium leading-snug tracking-tight text-foreground">
        {supperWhen(supper.startsAt, zone)}
      </h2>
      <p className={cn(TERM, "mt-0.5")}>{supper.rotationTitle}</p>
      <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
        {rows.map(([term, value]) => (
          <div key={term} className="min-w-0">
            <dt className={TERM}>{term}</dt>
            <dd className={cn(VALUE, "break-words")}>{value}</dd>
          </div>
        ))}
      </dl>
      <Link href={href} className={cn(buttonVariants({ variant: "secondary", size: "lg" }), "mt-5 w-full sm:w-auto")}>
        Open Supper club
      </Link>
    </section>
  );
}
