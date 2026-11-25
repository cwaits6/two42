"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { TriangleAlert } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { failureMessage } from "@/lib/errorCopy";
import { createClient } from "@/lib/supabase/client";

export interface SignUpRow {
  id: string;
  names: string;
  people: number;
  canHost: boolean;
  seats: number | null;
  status: string;
  address: string | null;
  foodNotes: string | null;
}

const NO_ONE = "none";

/** The season's parties with their counts, and an explicit add mode for signing someone up. */
export function SignUpList({
  seasonId,
  canChange,
  published,
  parties,
  available,
  hostsNeeded,
  tooFewHosts,
  perDinner,
}: {
  seasonId: string;
  /** A leader adds and removes parties while the season takes sign-ups or runs. */
  canChange: boolean;
  /** Tables are published: an added party waits for a table, and a removed one withdraws. */
  published: boolean;
  parties: SignUpRow[];
  /** Members of the group in no party yet. */
  available: { id: string; name: string }[];
  hostsNeeded: number;
  tooFewHosts: boolean;
  /** Tables change each dinner, so the host count is for each dinner. */
  perDinner: boolean;
}) {
  const router = useRouter();
  const firstId = useId();
  const secondId = useId();
  const [adding, setAdding] = useState(false);
  const [first, setFirst] = useState<string | null>(null);
  const [second, setSecond] = useState<string>(NO_ONE);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<SignUpRow | null>(null);

  const active = parties.filter((p) => p.status !== "withdrawn");
  const hosts = active.filter((p) => p.canHost);
  const people = active.reduce((sum, p) => sum + p.people, 0);
  const seats = hosts.reduce((sum, p) => sum + (p.seats ?? 0), 0);
  const personItems = available.map((p) => ({ value: p.id, label: p.name }));
  const secondItems = [{ value: NO_ONE, label: "No one" }, ...personItems.filter((p) => p.value !== first)];

  async function addParty() {
    if (!first) return;
    setSaving(true);
    const ids = second === NO_ONE ? [first] : [first, second];
    const { error } = await createClient().rpc("dinner_party_create", { _season_id: seasonId, _profile_ids: ids });
    setSaving(false);
    if (error?.code === "23505") return toast.error("Someone in this party is already signed up this season.");
    if (error) return toast.error(failureMessage("add the party"));
    setFirst(null);
    setSecond(NO_ONE);
    setAdding(false);
    toast.success(published ? "Party added to the waiting list. Seat them on the Tables page." : "Party added.");
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          ["Parties", active.length],
          ["Hosts", hosts.length],
          ["People", people],
          ["Seats", seats],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-border p-4">
            <dt className="text-base text-muted-foreground">{label}</dt>
            <dd className="text-3xl font-bold">{value}</dd>
          </div>
        ))}
      </dl>

      {tooFewHosts && (
        <p role="status" className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-lg">
          <TriangleAlert className="mt-1 size-5 shrink-0 text-destructive" aria-hidden="true" />
          {perDinner
            ? `Too few hosts: each dinner needs ${hostsNeeded} free that night.`
            : `Too few hosts: ${people} people need ${hostsNeeded} tables, and ${hosts.length} ${hosts.length === 1 ? "party offers" : "parties offer"} to host.`}
        </p>
      )}

      {parties.length === 0 ? (
        <p className="text-lg text-muted-foreground">Nobody has signed up yet.</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {parties.map((p) => (
            <li key={p.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1">
                <p className="text-lg font-semibold">{p.names}</p>
                <p className="text-base text-muted-foreground">
                  {[
                    p.people === 2 ? "2 people" : "1 person",
                    p.canHost ? `Hosts, ${p.seats ?? 0} seats` : null,
                    p.status === "waitlisted" ? "Waiting for a table" : null,
                    p.status === "withdrawn" ? "Withdrawn" : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {p.address && <p className="text-base">{p.address}</p>}
                {p.foodNotes && <p className="text-base">Food needs: {p.foodNotes}</p>}
              </div>
              {canChange && p.status !== "withdrawn" && (
                <Button variant="outline" size="lg" onClick={() => setRemoving(p)}>
                  Remove party
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canChange &&
        (adding ? (
          <div className="space-y-4 rounded-xl border border-border p-4">
            <div className="space-y-2">
              <Label htmlFor={firstId} className="text-lg">
                Person
              </Label>
              <Select
                items={personItems}
                value={first}
                onValueChange={(next) => {
                  setFirst(next);
                  if (next === second) setSecond(NO_ONE);
                }}
              >
                <SelectTrigger id={firstId} className="h-12 w-full text-lg">
                  <SelectValue placeholder="Choose someone" />
                </SelectTrigger>
                <SelectContent>
                  {personItems.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor={secondId} className="text-lg">
                Signing up with
              </Label>
              <Select items={secondItems} value={second} onValueChange={(next) => setSecond(next ?? NO_ONE)}>
                <SelectTrigger id={secondId} className="h-12 w-full text-lg">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {secondItems.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button size="lg" onClick={addParty} disabled={!first || saving}>
                {saving ? "Adding…" : "Add party"}
              </Button>
              <Button size="lg" variant="outline" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button size="lg" variant="outline" onClick={() => setAdding(true)} disabled={available.length === 0}>
            Add party
          </Button>
        ))}

      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Remove this party?"
        description={
          removing
            ? published
              ? `${removing.names}: their seats at dinners still to come are freed. Dinners that have happened keep them.`
              : `${removing.names}: this party comes off the season's sign-ups.`
            : undefined
        }
        confirmLabel="Remove party"
        pendingLabel="Removing…"
        onConfirm={async () => {
          if (!removing) return;
          // A party at a published table withdraws: the database keeps its
          // seats at dinners already held, which deleting it would lose.
          const parties = createClient().from("dinner_parties");
          const { data, error } = await (published
            ? parties.update({ status: "withdrawn" }).eq("id", removing.id).select("id")
            : parties.delete().eq("id", removing.id).select("id"));
          if (error || !data?.length) {
            toast.error(failureMessage("remove the party"));
            return;
          }
          setRemoving(null);
          toast.success("Party removed.");
          router.refresh();
        }}
      />
    </div>
  );
}
