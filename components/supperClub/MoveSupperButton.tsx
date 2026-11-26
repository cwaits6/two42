"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { movedNotice } from "@/lib/supperClub/emailOutcome";
import { failureMessage } from "@/lib/errorCopy";
import { MoveDialog, postMove } from "./MoveDialog";

/** Move supper, for the supper's host or a leader. */
export function MoveSupperButton({ supperId, startsAt, zone }: { supperId: string; startsAt: string; zone: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="lg" onClick={() => setOpen(true)}>
        Move supper
      </Button>
      <MoveDialog
        open={open}
        onOpenChange={setOpen}
        title="Move supper"
        description="Everyone else at the table gets an email with the new date, and is asked to reply again."
        initialIso={startsAt}
        zone={zone}
        onSave={async (iso) => {
          const result = await postMove(`/api/supper-club/suppers/${supperId}/move`, iso);
          if (!result.ok) {
            toast.error(result.message ?? failureMessage("move the supper"));
            return false;
          }
          const notice = movedNotice("Supper moved.", result.outcome);
          toast[notice.kind](notice.text);
          router.refresh();
          return true;
        }}
      />
    </>
  );
}
