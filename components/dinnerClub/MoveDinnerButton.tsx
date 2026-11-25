"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { failureMessage } from "@/lib/errorCopy";
import { MoveDialog, postMove } from "./MoveDialog";

/** Move dinner, for the dinner's host or a leader. */
export function MoveDinnerButton({ dinnerId, startsAt, zone }: { dinnerId: string; startsAt: string; zone: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="lg" onClick={() => setOpen(true)}>
        Move dinner
      </Button>
      <MoveDialog
        open={open}
        onOpenChange={setOpen}
        title="Move dinner"
        description="Everyone at the table gets an email with the new date, and is asked to reply again."
        initialIso={startsAt}
        zone={zone}
        onSave={async (iso) => {
          const result = await postMove(`/api/dinner-club/dinners/${dinnerId}/move`, iso);
          if (!result.ok) {
            toast.error(result.message ?? failureMessage("move the dinner"));
            return false;
          }
          toast.success("Dinner moved.");
          router.refresh();
          return true;
        }}
      />
    </>
  );
}
