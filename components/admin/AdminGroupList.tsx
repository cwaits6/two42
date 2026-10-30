"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GroupLeadersDialog, type LeaderGroup } from "@/components/admin/GroupLeadersDialog";
import type { AdminGroupRow } from "@/components/admin/adminGroups";


/** Every group in the church, with its leaders and the way to change them. */
export function AdminGroupList({ groups }: { groups: AdminGroupRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState<LeaderGroup | null>(null);

  if (groups.length === 0) {
    return <p className="text-lg text-muted-foreground">No groups yet.</p>;
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
              <p className="text-xl font-semibold">{g.name}</p>
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
