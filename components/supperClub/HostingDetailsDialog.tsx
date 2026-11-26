"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AddressFieldset, addressRow, hostingErrors, NO_ADDRESS, SeatsField, type HostingErrors } from "@/components/supperClub/HostingFields";
import { failureMessage } from "@/lib/errorCopy";
import { createClient } from "@/lib/supabase/client";

/**
 * For a leader: lets a party that didn't offer to host stand in or take over
 * a table, once they've agreed. Publish seats only a host that offered, with
 * seats and an address, and a member can't add those after sign-ups close.
 */
export function HostingDetailsDialog({
  party,
  rotationId,
  groupId,
}: {
  party: { id: string; names: string };
  rotationId: string;
  groupId: string;
}) {
  const router = useRouter();
  const ids = { seats: useId(), line1: useId() };
  const [open, setOpen] = useState(false);
  const [seats, setSeats] = useState("8");
  const [address, setAddress] = useState(NO_ADDRESS);
  const [errors, setErrors] = useState<HostingErrors>({});
  const [saving, setSaving] = useState(false);

  async function save() {
    const found = hostingErrors(seats, address);
    setErrors(found);
    if (found.seats || found.line1) return;
    setSaving(true);
    const supabase = createClient();
    // The address first: a party marked as a host must never be left without one.
    const written = await supabase
      .from("supper_party_addresses")
      .upsert(addressRow({ party_id: party.id, rotation_id: rotationId, group_id: groupId }, address), {
        onConflict: "party_id",
      })
      .select("party_id");
    const updated =
      written.error || !written.data?.length
        ? null
        : await supabase.from("supper_parties").update({ can_host: true, seats: Number(seats) }).eq("id", party.id).select("id");
    setSaving(false);
    if (!updated || updated.error || !updated.data?.length) {
      toast.error(failureMessage("save the hosting details"));
      return;
    }
    toast.success(`${party.names} can host now.`);
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button variant="outline" size="lg" onClick={() => setOpen(true)}>
        Add hosting details
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add hosting details</DialogTitle>
            <DialogDescription className="text-base">
              {party.names}: add these once they&apos;ve agreed to host. The people at their table see the address once you publish.
            </DialogDescription>
          </DialogHeader>
          <SeatsField id={ids.seats} value={seats} error={errors.seats} onChange={setSeats} />
          <AddressFieldset
            address={address}
            line1Id={ids.line1}
            line1Error={errors.line1}
            onChange={(key, value) => setAddress((a) => ({ ...a, [key]: value }))}
          />
          <div className="flex flex-col gap-3 sm:flex-row-reverse">
            <Button size="lg" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save hosting details"}
            </Button>
            <Button size="lg" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
