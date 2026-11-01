"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, Pencil } from "lucide-react";
import { AvatarCluster } from "@/components/directory/AvatarCluster";
import { MethodButton } from "@/components/giving/MethodButton";
import { fundRecipientLine } from "@/lib/giving/funds";
import { groupPath } from "@/lib/groups/active";
import type { ResolvedMethod } from "@/lib/giving/methods";

export interface FundView {
  id: string;
  name: string;
  description: string | null;
  /** e.g. "Through Jun 20, 2027" — derived from retire_on */
  tag: string | null;
  stewards: { name: string; initials: string; avatarUrl: string | null }[];
  /** "Linda & Ray Park" */
  stewardNames: string;
  role: string | null;
  methods: ResolvedMethod[];
  canManage: boolean;
}

/**
 * Quiet accordion list. One fund open at a time; payment
 * buttons expand in place so paying is two taps from page load.
 */
export function GiveList({ funds, groupId }: { funds: FundView[]; groupId: string }) {
  const [openId, setOpenId] = useState<string | null>(funds[0]?.id ?? null);

  return (
    <div className="space-y-3">
      {funds.map((fund) => {
        const open = fund.id === openId;
        return (
          <div
            key={fund.id}
            className={`overflow-hidden rounded-2xl border bg-card transition-shadow ${
              open
                ? "border-brand-primary/40 shadow-md shadow-brand-primary/10"
                : "border-border shadow-sm"
            }`}
          >
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpenId(open ? null : fund.id)}
              className="flex w-full items-center gap-3.5 p-4 text-left sm:px-5"
            >
              <AvatarCluster people={fund.stewards} />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-xl font-semibold text-foreground">
                    {fund.name}
                  </span>
                  {fund.tag && (
                    <span className="rounded-full bg-brand-bg-light px-2.5 py-0.5 text-sm font-semibold text-foreground">
                      {fund.tag}
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-base text-muted-foreground">
                  {fundRecipientLine(fund.stewardNames, fund.role)}
                </span>
              </span>
              <ChevronDown
                aria-hidden="true"
                className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform ${
                  open ? "rotate-180" : ""
                }`}
              />
            </button>

            {open && (
              <div className="px-4 pb-4 sm:px-5 sm:pb-5">
                {fund.description && (
                  <p className="mb-3.5 text-base leading-relaxed text-muted-foreground">
                    {fund.description}
                  </p>
                )}
                {fund.methods.length > 0 ? (
                  <div className="space-y-2">
                    {fund.methods.map((m) => (
                      <MethodButton key={m.method} resolved={m} />
                    ))}
                  </div>
                ) : (
                  <p className="text-base text-muted-foreground">
                    Members can&apos;t give to this fund until it has a payment
                    method.
                  </p>
                )}
                {fund.canManage && (
                  <div className="mt-2 flex justify-end">
                    <Link
                      href={groupPath(groupId, `/give/${fund.id}/edit`)}
                      className="inline-flex min-h-11 items-center gap-1.5 text-base font-semibold text-brand-primary-text hover:underline"
                    >
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                      Edit fund
                    </Link>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
