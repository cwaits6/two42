"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CreateGroupDialog } from "@/components/groups/CreateGroupDialog";

/** The Admin › Groups "Add group" button: the admin names the leader and stays on the page. */
export function AdminCreateGroupButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        size="lg"
        onClick={() => setOpen(true)}
      >
        <Plus aria-hidden="true" />
        Add group
      </Button>
      <CreateGroupDialog
        mode="create"
        isOrgAdmin
        open={open}
        onOpenChange={setOpen}
        onCreated={() => router.refresh()}
        onRequested={() => router.refresh()}
      />
    </>
  );
}
