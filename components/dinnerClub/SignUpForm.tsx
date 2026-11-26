"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldError, invalidFieldProps } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { AddressFieldset, addressRow, hostingErrors, SeatsField, type AddressFields } from "@/components/dinnerClub/HostingFields";
import type { DinnerFormat } from "@/lib/dinnerClub/shuffle";
import { failureMessage } from "@/lib/errorCopy";
import { createClient } from "@/lib/supabase/client";

export interface ExistingSignUp {
  partyId: string;
  partnerName: string | null;
  canHost: boolean;
  seats: number | null;
  preferredDateId: string | null;
  kidsWelcome: boolean;
  accessNotes: string;
  pets: string;
  address: AddressFields | null;
  foodNotes: string;
  unavailable: string[];
}

/** The person's own party last season, for Sign up again. */
export interface LastSeasonPrefill {
  partnerId: string | null;
  canHost: boolean;
  seats: number | null;
  kidsWelcome: boolean;
  accessNotes: string;
  pets: string;
  address: AddressFields | null;
  foodNotes: string;
}

type Option = { value: string; label: string };

const ME = "me";
const OTHER = "other";
const NO_PREFERENCE = "none";
const FIELD = "h-12 text-lg";

/** Sign up alone or with one other person in the group, or change a sign-up. */
export function SignUpForm({
  seasonId,
  groupId,
  format,
  meId,
  household,
  others,
  dates,
  existing,
  prefill,
  lastSeason,
}: {
  seasonId: string;
  groupId: string;
  format: DinnerFormat;
  meId: string;
  /** People in the person's household who are in the group and not signed up. */
  household: Option[];
  /** Everyone else in the group not signed up. */
  others: Option[];
  dates: Option[];
  existing: ExistingSignUp | null;
  /** The household's directory address, to start a host's address from. */
  prefill: AddressFields;
  /** Sign up again: last season's answers, kept only for a party of the same people. */
  lastSeason?: LastSeasonPrefill | null;
}) {
  const router = useRouter();
  const ids = { who: useId(), other: useId(), seats: useId(), pref: useId(), food: useId(), access: useId(), pets: useId() };
  const lastPartner = lastSeason?.partnerId ?? null;
  const startWho = !lastPartner
    ? ME
    : household.some((o) => o.value === lastPartner)
      ? lastPartner
      : others.some((o) => o.value === lastPartner)
        ? OTHER
        : ME;
  const startPartner = startWho === ME ? null : lastPartner;
  // Last season's address, food needs and home notes were that party's, so
  // they carry over only while the same people sign up together.
  const kept = lastSeason && startPartner === lastPartner ? lastSeason : null;
  const [who, setWho] = useState(startWho);
  const [other, setOther] = useState<string | null>(startWho === OTHER ? lastPartner : null);
  const createdPartyId = useRef<string | undefined>(undefined);
  // Once the party is saved, a retry saves only its details, so who is in it
  // can no longer change here.
  const [partySaved, setPartySaved] = useState(false);
  const [canHost, setCanHost] = useState(existing?.canHost ?? lastSeason?.canHost ?? false);
  const [seats, setSeats] = useState(String(existing?.seats ?? lastSeason?.seats ?? 8));
  const [address, setAddress] = useState<AddressFields>(existing?.address ?? kept?.address ?? prefill);
  const [preferred, setPreferred] = useState(existing?.preferredDateId ?? NO_PREFERENCE);
  const [unavailable, setUnavailable] = useState<string[]>(existing?.unavailable ?? []);
  const [kidsWelcome, setKidsWelcome] = useState(existing?.kidsWelcome ?? lastSeason?.kidsWelcome ?? false);
  const [accessNotes, setAccessNotes] = useState(existing?.accessNotes ?? kept?.accessNotes ?? "");
  const [pets, setPets] = useState(existing?.pets ?? kept?.pets ?? "");
  const [foodNotes, setFoodNotes] = useState(existing?.foodNotes ?? kept?.foodNotes ?? "");

  function choosePartner(nextWho: string, nextOther: string | null) {
    setWho(nextWho);
    setOther(nextOther);
    if (!lastSeason) return;
    const same = (nextWho === ME ? null : nextWho === OTHER ? nextOther : nextWho) === lastPartner;
    setAddress(same ? (lastSeason.address ?? prefill) : prefill);
    setAccessNotes(same ? lastSeason.accessNotes : "");
    setPets(same ? lastSeason.pets : "");
    setFoodNotes(same ? lastSeason.foodNotes : "");
  }
  const [errors, setErrors] = useState<{ seats?: string; line1?: string; other?: string }>({});
  const [saving, setSaving] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);

  const whoItems: Option[] = [
    { value: ME, label: "Just me" },
    ...household,
    ...(others.length > 0 ? [{ value: OTHER, label: "Someone else in the group" }] : []),
  ];
  const preferenceItems: Option[] = [{ value: NO_PREFERENCE, label: "No preference" }, ...dates];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const found = {
      other: !existing && who === OTHER && !other ? "Choose who you're signing up with." : undefined,
      ...(canHost ? hostingErrors(seats, address) : {}),
    };
    setErrors(found);
    if (found.other || found.seats || found.line1) return;

    setSaving(true);
    const supabase = createClient();
    const fail = (action: string, error?: { code?: string } | null) => {
      setSaving(false);
      toast.error(
        error?.code === "23505"
          ? "Someone in this party is already signed up this season."
          : error?.code === "DC003"
            ? "Sign-ups are closed."
            : failureMessage(action)
      );
    };

    // A party saved on an earlier try whose details were not: trying again
    // saves the details instead of signing up a second time.
    let partyId = existing?.partyId ?? createdPartyId.current;
    if (!partyId) {
      const partner = who === ME ? null : who === OTHER ? other : who;
      const { data, error } = await supabase.rpc("dinner_party_create", {
        _season_id: seasonId,
        _profile_ids: partner ? [meId, partner] : [meId],
      });
      if (error || !data) return fail("sign up", error);
      partyId = data as string;
      createdPartyId.current = partyId;
      setPartySaved(true);
    }

    const { data: updated, error: updateError } = await supabase
      .from("dinner_parties")
      .update({
        can_host: canHost,
        seats: canHost ? Number(seats) : null,
        preferred_season_date_id: canHost && format === "same_table_rotating" && preferred !== NO_PREFERENCE ? preferred : null,
        kids_welcome: canHost ? kidsWelcome : null,
        access_notes: canHost && accessNotes.trim() ? accessNotes.trim() : null,
        pets: canHost && pets.trim() ? pets.trim() : null,
      })
      .eq("id", partyId)
      .select("id");
    if (updateError || !updated?.length) return fail("save your sign-up", updateError);

    const keys = { party_id: partyId, season_id: seasonId, group_id: groupId };
    const addressWrite = canHost
      ? supabase
          .from("dinner_party_addresses")
          .upsert(addressRow(keys, address), { onConflict: "party_id" })
          .select("party_id")
      : supabase.from("dinner_party_addresses").delete().eq("party_id", partyId).select("party_id");
    const notesWrite = foodNotes.trim()
      ? supabase
          .from("dinner_party_notes")
          .upsert({ ...keys, food_notes: foodNotes.trim() }, { onConflict: "party_id" })
          .select("party_id")
      : supabase.from("dinner_party_notes").delete().eq("party_id", partyId).select("party_id");
    const [addressResult, notesResult] = await Promise.all([addressWrite, notesWrite]);
    if (addressResult.error || (canHost && !addressResult.data?.length)) return fail("save your address", addressResult.error);
    if (notesResult.error || (foodNotes.trim() && !notesResult.data?.length)) return fail("save your food needs", notesResult.error);

    if (format === "new_tables") {
      const chosen = canHost ? unavailable : [];
      const { data, error } = await supabase.rpc("dinner_party_unavailable_dates_replace", {
        _party_id: partyId,
        _season_date_ids: chosen,
      });
      if (error || data !== chosen.length) return fail("save the dates you can't host", error);
    }

    setSaving(false);
    toast.success(existing ? "Sign-up saved." : "You're signed up.");
    router.refresh();
  }

  const setLine = (key: keyof AddressFields, value: string) => {
    setAddress((a) => ({ ...a, [key]: value }));
    if (key === "address_line1") setErrors((x) => ({ ...x, line1: undefined }));
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl font-bold">{existing ? "Your sign-up" : lastSeason ? "Sign up again" : "Sign up"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {!existing && lastSeason && (
            <p className="text-lg">Your answers from last season are filled in. Change anything before you sign up.</p>
          )}
          {existing ? (
            <p className="text-lg">{existing.partnerName ? `You and ${existing.partnerName}` : "Just you"}</p>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor={ids.who} className="text-lg">
                  Who&apos;s coming
                </Label>
                <Select items={whoItems} value={who} disabled={partySaved} onValueChange={(next) => next && choosePartner(next, next === OTHER ? other : null)}>
                  <SelectTrigger id={ids.who} className={`w-full ${FIELD}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {whoItems.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-base text-muted-foreground">Kids aren&apos;t seated; sign up the adults coming.</p>
              </div>
              {who === OTHER && (
                <div className="space-y-2">
                  <Label htmlFor={ids.other} className="text-lg">
                    Signing up with
                  </Label>
                  <Select items={others} value={other} disabled={partySaved} onValueChange={(next) => {
                      choosePartner(OTHER, next);
                      setErrors((x) => ({ ...x, other: undefined }));
                    }}>
                    <SelectTrigger id={ids.other} className={`w-full ${FIELD}`} {...invalidFieldProps(ids.other, errors.other)}>
                      <SelectValue placeholder="Choose someone" />
                    </SelectTrigger>
                    <SelectContent>
                      {others.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldError fieldId={ids.other} message={errors.other} />
                </div>
              )}
            </>
          )}

          <div className="flex min-h-11 items-center gap-3">
            <Checkbox id={`${ids.seats}-host`} checked={canHost} onCheckedChange={(checked) => setCanHost(checked === true)} />
            <Label htmlFor={`${ids.seats}-host`} className="text-lg font-normal">
              I can host
            </Label>
          </div>

          {canHost && (
            <div className="space-y-6 rounded-xl border border-border p-4">
              {format === "same_table_one_host" && (
                <p className="text-lg">Hosting means hosting every dinner of the season.</p>
              )}
              <SeatsField
                id={ids.seats}
                value={seats}
                error={errors.seats}
                hint="How many fit at your table, you included."
                onChange={(value) => {
                  setSeats(value);
                  setErrors((x) => ({ ...x, seats: undefined }));
                }}
              />

              <AddressFieldset
                address={address}
                line1Id={`${ids.seats}-line1`}
                line1Error={errors.line1}
                hint={<>The group&apos;s leaders see it. The people at your table see it once the tables are published.</>}
                onChange={setLine}
              />

              {format === "same_table_rotating" && (
                <div className="space-y-2">
                  <Label htmlFor={ids.pref} className="text-lg">
                    Date you&apos;d like to host
                  </Label>
                  <Select items={preferenceItems} value={preferred} onValueChange={(next) => next && setPreferred(next)}>
                    <SelectTrigger id={ids.pref} className={`w-full ${FIELD}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {preferenceItems.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {format === "new_tables" && dates.length > 0 && (
                <fieldset className="space-y-2">
                  <legend className="text-lg font-medium">Dates you can&apos;t host</legend>
                  {dates.map((d) => (
                    <div key={d.value} className="flex min-h-11 items-center gap-3">
                      <Checkbox
                        id={`${ids.pref}-${d.value}`}
                        checked={unavailable.includes(d.value)}
                        onCheckedChange={(checked) =>
                          setUnavailable((list) => (checked === true ? [...list, d.value] : list.filter((id) => id !== d.value)))
                        }
                      />
                      <Label htmlFor={`${ids.pref}-${d.value}`} className="text-lg font-normal">
                        {d.label}
                      </Label>
                    </div>
                  ))}
                </fieldset>
              )}

              <div className="flex min-h-11 items-center gap-3">
                <Checkbox id={`${ids.pref}-kids`} checked={kidsWelcome} onCheckedChange={(checked) => setKidsWelcome(checked === true)} />
                <Label htmlFor={`${ids.pref}-kids`} className="text-lg font-normal">
                  Kids welcome at our home
                </Label>
              </div>
              <div className="space-y-2">
                <Label htmlFor={ids.access} className="text-lg">
                  Stairs or other access notes
                </Label>
                <Textarea id={ids.access} rows={2} maxLength={500} value={accessNotes} className="text-lg" onChange={(e) => setAccessNotes(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor={ids.pets} className="text-lg">
                  Pets in the home
                </Label>
                <Input id={ids.pets} maxLength={200} value={pets} className={FIELD} onChange={(e) => setPets(e.target.value)} />
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor={ids.food} className="text-lg">
              Food needs or allergies
            </Label>
            <Textarea id={ids.food} rows={2} maxLength={500} value={foodNotes} className="text-lg" onChange={(e) => setFoodNotes(e.target.value)} />
            <p className="text-base text-muted-foreground">
              Seen by you, your partner, the group&apos;s leaders and the host of each dinner you&apos;re at.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3 sm:flex-row">
        <Button type="submit" size="lg" disabled={saving}>
          {saving ? "Saving…" : existing ? "Save sign-up" : "Sign up"}
        </Button>
        {existing && (
          <Button type="button" size="lg" variant="outline" onClick={() => setWithdrawing(true)}>
            Withdraw
          </Button>
        )}
      </div>

      {existing && (
        <ConfirmDialog
          open={withdrawing}
          onOpenChange={setWithdrawing}
          title="Withdraw from this season?"
          description="Your sign-up is removed. You can sign up again while sign-ups are open."
          confirmLabel="Withdraw"
          pendingLabel="Withdrawing…"
          onConfirm={async () => {
            const { data, error } = await createClient().from("dinner_parties").delete().eq("id", existing.partyId).select("id");
            if (error || !data?.length) {
              toast.error(failureMessage("withdraw"));
              return;
            }
            setWithdrawing(false);
            toast.success("You've withdrawn.");
            router.refresh();
          }}
        />
      )}
    </form>
  );
}
