"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, Pencil } from "lucide-react";
import { AvatarCluster } from "@/components/directory/AvatarCluster";
import { MethodButton } from "@/components/giving/MethodButton";
import { groupPath } from "@/lib/groups/active";
import type { ResolvedMethod } from "@/lib/giving/methods";

export interface FundView {
  id: string;
  name: string;
  description: string | null;
  /** e.g. "Through Jun 20" — derived from retire_on */
  tag: string | null;
  stewards: { name: string; initials: string; avatarUrl: string | null }[];
  /** "Linda & Ray Park" */
  stewardNames: string;
  role: string | null;
  methods: ResolvedMethod[];
  canManage: boolean;
}

/**
 * Direction A — quiet accordion list. One fund open at a time; payment
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
                    <span className="rounded-full bg-brand-bg-light px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-foreground">
                      {fund.tag}
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-sm text-muted-foreground">
                  {fund.stewardNames}
                  {fund.role ? ` · ${fund.role}` : ""}
                </span>
              </span>
              <ChevronDown
                aria-hidden="true"
                className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
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
                  <p className="rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
                    No payment methods set up yet — add your handles to make
                    this fund payable.
                  </p>
                )}
                {fund.canManage && (
                  <div className="mt-3.5 flex justify-end text-sm">
                    <Link
                      href={groupPath(groupId, `/give/${fund.id}/edit`)}
                      className="flex items-center gap-1 font-semibold text-brand-primary hover:underline"
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                      Edit
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
