"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { failureMessage } from "@/lib/errorCopy";
import { createClient } from "@/lib/supabase/client";

/**
 * Withdraws a party once sign-ups have closed. The party stays on the
 * season's record: its seats at dinners still to come are freed, and the
 * dinners already held keep it.
 */
export function WithdrawButton({
  partyId,
  label,
  title,
  description,
  done,
}: {
  partyId: string;
  label: string;
  title: string;
  description: string;
  done: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="lg" onClick={() => setOpen(true)}>
        {label}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={title}
        description={description}
        confirmLabel={label}
        pendingLabel="Saving…"
        onConfirm={async () => {
          const { data, error } = await createClient()
            .from("dinner_parties")
            .update({ status: "withdrawn" })
            .eq("id", partyId)
            .select("id");
          if (error || !data?.length) {
            toast.error(failureMessage(label.toLowerCase()));
            return;
          }
          setOpen(false);
          toast.success(done);
          router.refresh();
        }}
      />
    </>
  );
}
