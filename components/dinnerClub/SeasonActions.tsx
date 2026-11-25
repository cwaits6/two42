"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import type { SeasonStatus } from "@/lib/dinnerClub/labels";
import { failureMessage } from "@/lib/errorCopy";
import { groupPath } from "@/lib/groups/active";
import { createClient } from "@/lib/supabase/client";

export function SeasonActions({
  groupId,
  seasonId,
  status,
}: {
  groupId: string;
  seasonId: string;
  status: SeasonStatus;
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [opening, setOpening] = useState(false);
  const [ending, setEnding] = useState(false);
  const base = groupPath(groupId, `/dinner-club/seasons/${seasonId}`);

  async function openSignUps() {
    setOpening(true);
    const { data, error } = await createClient()
      .from("dinner_seasons")
      .update({ status: "open" })
      .eq("id", seasonId)
      .select("id");
    setOpening(false);
    if (error?.code === "23505") return toast.error("Another season in this group is taking sign-ups or running.");
    if (error || !data?.length) return toast.error(failureMessage("open sign-ups"));
    toast.success("Sign-ups are open.");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
      {status === "draft" && (
        <Button size="lg" onClick={openSignUps} disabled={opening}>
          {opening ? "Opening…" : "Open sign-ups"}
        </Button>
      )}
      {(status === "open" || status === "published") && (
        <Button size="lg" nativeButton={false} render={<Link href={`${base}/tables`} />}>
          {status === "open" ? "Make tables" : "View tables"}
        </Button>
      )}
      {status !== "ended" && (
        <Button size="lg" variant="outline" nativeButton={false} render={<Link href={`${base}/edit`} />}>
          Edit season
        </Button>
      )}
      {status === "published" && (
        <Button size="lg" variant="outline" onClick={() => setEnding(true)}>
          End season
        </Button>
      )}
      {status === "ended" && (
        <Button
          size="lg"
          nativeButton={false}
          render={<Link href={`${groupPath(groupId, "/dinner-club/seasons/new")}?from=${seasonId}`} />}
        >
          Start next season
        </Button>
      )}
      {status === "draft" && (
        <Button size="lg" variant="outline" onClick={() => setDeleting(true)}>
          Delete season
        </Button>
      )}
      <ConfirmDialog
        open={ending}
        onOpenChange={setEnding}
        title="End this season?"
        description="Members keep seeing their tables. Replies, moves and dinner emails stop. This can't be undone."
        confirmLabel="End season"
        pendingLabel="Ending…"
        confirmVariant="default"
        onConfirm={async () => {
          const { data, error } = await createClient()
            .from("dinner_seasons")
            .update({ status: "ended" })
            .eq("id", seasonId)
            .select("id");
          if (error || !data?.length) {
            toast.error(failureMessage("end the season"));
            return;
          }
          setEnding(false);
          toast.success("Season ended.");
          router.refresh();
        }}
      />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete this season?"
        description="Its dates go with it. This can't be undone."
        confirmLabel="Delete season"
        pendingLabel="Deleting…"
        confirmVariant="destructive"
        onConfirm={async () => {
          const { data, error } = await createClient().from("dinner_seasons").delete().eq("id", seasonId).select("id");
          if (error || !data?.length) {
            toast.error(failureMessage("delete the season"));
            return;
          }
          toast.success("Season deleted.");
          router.push(groupPath(groupId, "/dinner-club"));
          router.refresh();
        }}
      />
    </div>
  );
}
