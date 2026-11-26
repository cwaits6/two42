"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import type { RotationStatus } from "@/lib/supperClub/labels";
import { failureMessage } from "@/lib/errorCopy";
import { groupPath } from "@/lib/groups/active";
import { createClient } from "@/lib/supabase/client";

export function RotationActions({
  groupId,
  rotationId,
  status,
}: {
  groupId: string;
  rotationId: string;
  status: RotationStatus;
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [opening, setOpening] = useState(false);
  const [ending, setEnding] = useState(false);
  const base = groupPath(groupId, `/supper-club/rotations/${rotationId}`);

  async function openSignUps() {
    setOpening(true);
    const { data, error } = await createClient()
      .from("supper_rotations")
      .update({ status: "open" })
      .eq("id", rotationId)
      .select("id");
    setOpening(false);
    if (error?.code === "23505") return toast.error("Another rotation in this group is taking sign-ups or running.");
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
          Edit rotation
        </Button>
      )}
      {status === "published" && (
        <Button size="lg" variant="outline" onClick={() => setEnding(true)}>
          End rotation
        </Button>
      )}
      {status === "ended" && (
        <Button
          size="lg"
          nativeButton={false}
          render={<Link href={`${groupPath(groupId, "/supper-club/rotations/new")}?from=${rotationId}`} />}
        >
          Start next rotation
        </Button>
      )}
      {status === "draft" && (
        <Button size="lg" variant="outline" onClick={() => setDeleting(true)}>
          Delete rotation
        </Button>
      )}
      <ConfirmDialog
        open={ending}
        onOpenChange={setEnding}
        title="End this rotation?"
        description="Members keep seeing their tables. Replies, moves and supper emails stop. This can't be undone."
        confirmLabel="End rotation"
        pendingLabel="Ending…"
        confirmVariant="default"
        onConfirm={async () => {
          const { data, error } = await createClient()
            .from("supper_rotations")
            .update({ status: "ended" })
            .eq("id", rotationId)
            .select("id");
          if (error || !data?.length) {
            toast.error(failureMessage("end the rotation"));
            return;
          }
          setEnding(false);
          toast.success("Rotation ended.");
          router.refresh();
        }}
      />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete this rotation?"
        description="Its dates go with it. This can't be undone."
        confirmLabel="Delete rotation"
        pendingLabel="Deleting…"
        confirmVariant="destructive"
        onConfirm={async () => {
          const { data, error } = await createClient().from("supper_rotations").delete().eq("id", rotationId).select("id");
          if (error || !data?.length) {
            toast.error(failureMessage("delete the rotation"));
            return;
          }
          toast.success("Rotation deleted.");
          router.push(groupPath(groupId, "/supper-club"));
          router.refresh();
        }}
      />
    </div>
  );
}
