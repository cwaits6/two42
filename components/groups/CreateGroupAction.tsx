"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGroupCreation } from "@/components/groups/GroupProvider";
import {
  CreateGroupDialog,
  type CreatedGroup,
  type RequestedGroup,
} from "@/components/groups/CreateGroupDialog";
import { createClient } from "@/lib/supabase/client";
import { groupPath } from "@/lib/groups/active";
import { creationActionFor } from "@/lib/groups/creation";
import { cn } from "@/lib/utils";

/**
 * The member-facing "Create a group" / "Request a group" button with its
 * dialog. Renders nothing when the org leaves creation to its admins. In
 * request mode the viewer's own pending requests are listed under it.
 */
export function CreateGroupAction({ className }: { className?: string }) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const { policy, isOrgAdmin } = useGroupCreation();
  const action = creationActionFor(policy, isOrgAdmin);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<RequestedGroup[]>([]);

  const requesting = action?.kind === "request";

  // RLS narrows group_requests to the viewer's own rows for a non-admin.
  useEffect(() => {
    if (!requesting) return;
    let cancelled = false;
    supabase
      .from("group_requests")
      .select("id, name")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error("Failed to load the viewer's group requests:", error);
          return;
        }
        setPending(data ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [requesting, supabase]);

  if (!action) return null;

  function handleCreated({ id, viewerIsLeader }: CreatedGroup) {
    if (viewerIsLeader) router.push(groupPath(id, "/dashboard"));
    router.refresh();
  }

  function handleRequested(request: RequestedGroup) {
    setPending((prev) => [...prev, request]);
  }

  return (
    <div className={cn("space-y-3", className)}>
      <Button
        size="lg"
        onClick={() => setOpen(true)}
        className="bg-brand-primary text-white hover:bg-brand-primary/90"
      >
        <Plus aria-hidden="true" />
        {action.label}
      </Button>
      {requesting && pending.length > 0 && (
        <ul className="space-y-1 text-base text-muted-foreground">
          {pending.map((request) => (
            <li key={request.id}>Waiting for approval: {request.name}</li>
          ))}
        </ul>
      )}
      <CreateGroupDialog
        mode={action.kind}
        isOrgAdmin={isOrgAdmin}
        open={open}
        onOpenChange={setOpen}
        onCreated={handleCreated}
        onRequested={handleRequested}
      />
    </div>
  );
}
