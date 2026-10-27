"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { groupPath } from "@/lib/groups/active";
import { joinErrorMessage, joinRowState, type DiscoverableGroup } from "@/lib/groups/joining";

const STATE_TEXT = "text-base font-semibold text-muted-foreground";

/**
 * The trailing end of one discovery row: the viewer's standing in the
 * group, or the one action that changes it. join_group() decides whether
 * the click joins or files a request; the toast says which happened.
 */
export function GroupJoinAction({
  row,
  onChanged,
}: {
  row: DiscoverableGroup;
  onChanged: () => void;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [busy, setBusy] = useState(false);
  const state = joinRowState(row);

  async function join() {
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("join_group", { _group_id: row.id });
      if (error) {
        toast.error(joinErrorMessage(error.code));
        return;
      }
      if (data === "joined") {
        toast.success(`You joined ${row.name}.`);
        // The sidebar and switcher come from the root layout.
        router.refresh();
      } else {
        toast.success("Request sent.");
      }
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  switch (state) {
    case "leads":
      return <span className={STATE_TEXT}>You lead this group</span>;
    case "member":
      return (
        <span className="flex flex-wrap items-center justify-end gap-3">
          <span className={STATE_TEXT}>You are a member</span>
          <Button
            size="lg"
            variant="outline"
            nativeButton={false}
            render={<Link href={groupPath(row.id, "/dashboard")} />}
          >
            Open group
          </Button>
        </span>
      );
    case "private":
      return (
        <Badge variant="outline" className="h-auto px-3 py-1.5 text-base">
          Private · invite only
        </Badge>
      );
    case "requested":
      return <span className={STATE_TEXT}>Request sent</span>;
    case "join":
      return (
        <Button
          size="lg"
          disabled={busy}
          onClick={join}
        >
          Join
        </Button>
      );
    case "request":
      return (
        <Button size="lg" variant="outline" disabled={busy} onClick={join}>
          Request to join
        </Button>
      );
  }
}
