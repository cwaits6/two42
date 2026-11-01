"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { UsersRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GroupLeadersDialog, type LeaderGroup } from "@/components/admin/GroupLeadersDialog";
import { adminGroupHref, type AdminGroupRow } from "@/components/admin/adminGroups";
import { EmptyState } from "@/components/states/EmptyState";

/** Every group in the church, with its leaders and the way to change them. */
export function AdminGroupList({
  groups,
  memberGroupIds,
}: {
  groups: AdminGroupRow[];
  /** The groups the viewer is in, whose own pages they can open. */
  memberGroupIds: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState<LeaderGroup | null>(null);

  if (groups.length === 0) {
    return <EmptyState icon={UsersRound} message="No groups yet." />;
  }

  return (
    <>
      <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
        {groups.map((g) => (
          <li
            key={g.id}
            className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0 space-y-1">
              <Link
                href={adminGroupHref(g.id, memberGroupIds)}
                className="inline-flex min-h-11 items-center text-xl font-semibold text-brand-primary-text underline underline-offset-4 hover:text-foreground"
              >
                {g.name}
              </Link>
              {g.description && <p className="text-base text-muted-foreground">{g.description}</p>}
              {g.leaderNames.length === 0 ? (
                <Badge variant="destructive">No leader</Badge>
              ) : (
                <p className="text-base">
                  <span className="text-muted-foreground">
                    {g.leaderNames.length === 1 ? "Leader: " : "Leaders: "}
                  </span>
                  {g.leaderNames.join(", ")}
                </p>
              )}
              <p className="text-base text-muted-foreground">
                {g.memberCount} member{g.memberCount !== 1 ? "s" : ""}
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() => setOpen({ id: g.id, name: g.name })}
              aria-label={`Manage leaders of ${g.name}`}
              className="w-full shrink-0 sm:w-auto"
            >
              Manage leaders
            </Button>
          </li>
        ))}
      </ul>
      <GroupLeadersDialog
        group={open}
        onClose={() => setOpen(null)}
        onChanged={() => router.refresh()}
      />
    </>
  );
}
