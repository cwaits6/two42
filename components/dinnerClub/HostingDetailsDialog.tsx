"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FieldError, invalidFieldProps } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { failureMessage } from "@/lib/errorCopy";
import { createClient } from "@/lib/supabase/client";

const FIELD = "h-12 text-lg";
const EMPTY = { address_line1: "", address_line2: "", city: "", state: "", postal_code: "" };

/**
 * For a leader: lets a party that didn't offer to host stand in or take over
 * a table, once they've agreed. Publish seats only a host that offered, with
 * seats and an address, and a member can't add those after sign-ups close.
 */
export function HostingDetailsDialog({
  party,
  seasonId,
  groupId,
}: {
  party: { id: string; names: string };
  seasonId: string;
  groupId: string;
}) {
  const router = useRouter();
  const ids = { seats: useId(), line1: useId() };
  const [open, setOpen] = useState(false);
  const [seats, setSeats] = useState("8");
  const [address, setAddress] = useState(EMPTY);
  const [errors, setErrors] = useState<{ seats?: string; line1?: string }>({});
  const [saving, setSaving] = useState(false);
  const setLine = (key: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setAddress((a) => ({ ...a, [key]: e.target.value }));

  async function save() {
    const seatCount = Number(seats);
    const found = {
      seats: Number.isInteger(seatCount) && seatCount >= 2 && seatCount <= 20 ? undefined : "Enter 2 to 20 seats.",
      line1: address.address_line1.trim() ? undefined : "Enter the address for the dinners.",
    };
    setErrors(found);
    if (found.seats || found.line1) return;
    setSaving(true);
    const supabase = createClient();
    const [updated, written] = await Promise.all([
      supabase.from("dinner_parties").update({ can_host: true, seats: seatCount }).eq("id", party.id).select("id"),
      supabase
        .from("dinner_party_addresses")
        .upsert(
          {
            party_id: party.id,
            season_id: seasonId,
            group_id: groupId,
            address_line1: address.address_line1.trim(),
            address_line2: address.address_line2.trim() || null,
            city: address.city.trim() || null,
            state: address.state.trim() || null,
            postal_code: address.postal_code.trim() || null,
          },
          { onConflict: "party_id" }
        )
        .select("party_id"),
    ]);
    setSaving(false);
    if (updated.error || !updated.data?.length || written.error || !written.data?.length) {
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
          <div className="space-y-2">
            <Label htmlFor={ids.seats} className="text-lg">
              Seats
            </Label>
            <Input
              id={ids.seats}
              type="number"
              inputMode="numeric"
              min={2}
              max={20}
              value={seats}
              className={`${FIELD} sm:w-40`}
              onChange={(e) => setSeats(e.target.value)}
              {...invalidFieldProps(ids.seats, errors.seats)}
            />
            <FieldError fieldId={ids.seats} message={errors.seats} />
          </div>
          <fieldset className="space-y-3">
            <legend className="text-lg font-medium">Address for the dinners</legend>
            <Input aria-label="Street address" placeholder="Street address" maxLength={200} value={address.address_line1} className={FIELD} onChange={setLine("address_line1")} {...invalidFieldProps(ids.line1, errors.line1)} />
            <FieldError fieldId={ids.line1} message={errors.line1} />
            <Input aria-label="Apartment or unit" placeholder="Apartment or unit" maxLength={200} value={address.address_line2} className={FIELD} onChange={setLine("address_line2")} />
            <div className="grid gap-3 sm:grid-cols-3">
              <Input aria-label="City" placeholder="City" maxLength={100} value={address.city} className={FIELD} onChange={setLine("city")} />
              <Input aria-label="State" placeholder="State" maxLength={100} value={address.state} className={FIELD} onChange={setLine("state")} />
              <Input aria-label="ZIP code" placeholder="ZIP code" maxLength={20} value={address.postal_code} className={FIELD} onChange={setLine("postal_code")} />
            </div>
          </fieldset>
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
