"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { FieldError, invalidFieldProps } from "@/components/ui/field-error";
import {
  Combobox,
  ComboboxInput,
  ComboboxPopup,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
} from "@/components/ui/combobox";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { toast } from "sonner";
import { failureMessage } from "@/lib/errorCopy";
import { AvatarCluster } from "@/components/directory/AvatarCluster";
import { PostingTo } from "@/components/groups/PostingTo";
import { MethodButton, MethodChip } from "@/components/giving/MethodButton";
import {
  FUND_NAME_FIELD,
  METHODS_FIELD,
  fundFieldErrors,
  fundRecipientLine,
  fundStatus,
  fundThroughTag,
  methodAccountField,
  methodToggleField,
  reopenedFund,
  type FundMethodInput,
} from "@/lib/giving/funds";
import { groupPath } from "@/lib/groups/active";
import {
  METHOD_ORDER,
  PAYMENT_METHODS,
  type ResolvedMethod,
} from "@/lib/giving/methods";
import type {
  GivingFund,
  GivingFundMethod,
  PaymentMethodKey,
} from "@/lib/types";

export interface MemberOption {
  id: string;
  name: string;
  initials: string;
  avatarUrl: string | null;
}

interface FundFormProps {
  /** null = create */
  fund: (GivingFund & { methods: GivingFundMethod[] }) | null;
  members: MemberOption[];
  currentUserId: string;
  isLeader: boolean;
  groupId: string;
  groupName: string;
  backHref: string;
  /** "YYYY-MM-DD" in the church's time zone */
  today: string;
}

const NONE = "none";

// The shared unchecked track is pale on pale; a person has to tell off from on at a glance.
const CLEAR_OFF_TRACK = "data-unchecked:[&>[data-slot=switch-track]]:bg-muted-foreground";

export function FundForm({
  fund,
  members,
  currentUserId,
  isLeader,
  groupId,
  groupName,
  backHref,
  today,
}: FundFormProps) {
  const router = useRouter();
  const supabase = createClient();

  const [name, setName] = useState(fund?.name ?? "");
  const [description, setDescription] = useState(fund?.description ?? "");
  const [stewardId, setStewardId] = useState(fund?.steward_id ?? currentUserId);
  const [coStewardId, setCoStewardId] = useState(fund?.co_steward_id ?? NONE);
  const [stewardRole, setStewardRole] = useState(fund?.steward_role ?? "");
  const [retireOn, setRetireOn] = useState(fund?.retire_on ?? "");
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // An object, so a second save with the same first error still refocuses.
  const [focusTarget, setFocusTarget] = useState<{ id: string } | null>(null);
  const [methods, setMethods] = useState<FundMethodInput>(() => {
    const state = {} as FundMethodInput;
    for (const key of METHOD_ORDER) {
      const existing = fund?.methods.find((m) => m.method === key);
      state[key] = {
        enabled: !!existing,
        custom: existing?.custom_handle ?? "",
      };
    }
    return state;
  });

  // Focus waits for the render that ties the message to the field, so a
  // screen reader reads the message when focus lands.
  useEffect(() => {
    if (focusTarget) document.getElementById(focusTarget.id)?.focus();
  }, [focusTarget]);

  const steward = members.find((m) => m.id === stewardId);
  const coSteward =
    coStewardId !== NONE ? members.find((m) => m.id === coStewardId) : undefined;

  const stewardNames = useMemo(() => {
    if (!steward) return "";
    if (!coSteward) return steward.name;
    return `${steward.name.split(" ")[0]} & ${coSteward.name}`;
  }, [steward, coSteward]);

  const memberLabel = (id: string) =>
    id === NONE ? "Nobody" : members.find((m) => m.id === id)?.name ?? "";

  const memberIds = useMemo(() => members.map((m) => m.id), [members]);

  const coMemberIds = useMemo(
    () => [NONE, ...members.filter((m) => m.id !== stewardId).map((m) => m.id)],
    [members, stewardId]
  );

  const previewMethods: ResolvedMethod[] = METHOD_ORDER.flatMap((key) => {
    const m = methods[key];
    if (!m.enabled) return [];
    const handle = m.custom.trim();
    if (!handle) return [];
    return [{ method: key, handle, meta: PAYMENT_METHODS[key] }];
  });

  function clearErrors(...ids: string[]) {
    setErrors((prev) => {
      const next = { ...prev };
      for (const id of ids) delete next[id];
      return next;
    });
  }

  function setMethod(key: PaymentMethodKey, patch: Partial<FundMethodInput[PaymentMethodKey]>) {
    setMethods((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
    clearErrors(METHODS_FIELD, methodAccountField(key));
  }

  async function save() {
    const found = fundFieldErrors(name, methods);
    setErrors(found);
    const firstInvalid = Object.keys(found)[0];
    if (firstInvalid) {
      setFocusTarget({ id: firstInvalid });
      return;
    }
    setSaving(true);

    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      steward_id: stewardId,
      co_steward_id: coStewardId === NONE ? null : coStewardId,
      steward_role: stewardRole.trim() || null,
      retire_on: retireOn || null,
      updated_at: new Date().toISOString(),
    };

    let fundId = fund?.id;
    if (fundId) {
      // A write the RLS policy rejects matches zero rows without an error.
      const { data, error } = await supabase
        .from("giving_funds")
        .update(payload)
        .eq("id", fundId)
        .eq("group_id", groupId)
        .select("id");
      if (error || !data?.length) {
        setSaving(false);
        toast.error(failureMessage("save the fund"));
        return;
      }
    } else {
      const { data, error } = await supabase
        .from("giving_funds")
        .insert({ ...payload, group_id: groupId, created_by: currentUserId })
        .select("id")
        .single();
      if (error || !data) {
        setSaving(false);
        toast.error(failureMessage("add the fund"));
        return;
      }
      fundId = data.id;
    }

    // Reconcile methods: upsert the usable rows first, then prune the
    // rest — a failed write never leaves the fund with no methods.
    const rows = METHOD_ORDER.flatMap((key, i) =>
      methods[key].enabled
        ? [
            {
              fund_id: fundId,
              group_id: groupId,
              method: key,
              custom_handle: methods[key].custom.trim(),
              display_order: i,
            },
          ]
        : []
    );
    const pruned = METHOD_ORDER.filter(
      (key) => !rows.some((r) => r.method === key)
    );
    const { error: upsertError } = await supabase.from("giving_fund_methods").upsert(rows);
    const { error: delError } =
      !upsertError && pruned.length > 0
        ? await supabase
            .from("giving_fund_methods")
            .delete()
            .eq("fund_id", fundId)
            .eq("group_id", groupId)
            .in("method", pruned)
        : { error: null };

    // Once a new fund exists, saving stays on until navigation unmounts the
    // form: another save from the add form would insert a second fund.
    if (upsertError || delError) {
      toast.error("Fund saved, but couldn't save its payment methods. Try again.");
      if (fund) setSaving(false);
      else router.replace(groupPath(groupId, `/give/${fundId}/edit`));
      return;
    }
    toast.success(fund ? "Fund updated." : "Fund added.");
    router.push(backHref);
    router.refresh();
  }

  async function setLive(live: boolean) {
    if (!fund) return;
    const { data, error } = await supabase
      .from("giving_funds")
      .update({
        ...(live ? reopenedFund(fund.retire_on, today) : { is_active: false }),
        updated_at: new Date().toISOString(),
      })
      .eq("id", fund.id)
      .eq("group_id", groupId)
      .select("id");
    if (error || !data?.length) {
      toast.error(failureMessage(live ? "reopen the fund" : "retire the fund"));
      return;
    }
    toast.success(live ? "Fund reopened." : "Fund retired.");
    router.push(backHref);
    router.refresh();
  }

  async function remove() {
    if (!fund) return;
    const { data, error } = await supabase
      .from("giving_funds")
      .delete()
      .eq("id", fund.id)
      .eq("group_id", groupId)
      .select("id");
    if (error || !data?.length) {
      toast.error(failureMessage("delete the fund"));
      return;
    }
    toast.success("Fund deleted.");
    router.push(backHref);
    router.refresh();
  }

  const previewTag = fundThroughTag(retireOn || null);
  const isLive = fund ? fundStatus(fund, today).live : false;

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_340px] lg:items-start">
      <div className="space-y-6">
        {!fund && <PostingTo groupName={groupName} />}
        <div>
          <Label htmlFor={FUND_NAME_FIELD}>Fund name</Label>
          <Input
            id={FUND_NAME_FIELD}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              clearErrors(FUND_NAME_FIELD);
            }}
            placeholder="Building fund"
            maxLength={80}
            className="mt-1.5"
            {...invalidFieldProps(FUND_NAME_FIELD, errors[FUND_NAME_FIELD])}
          />
          <div className="mt-1.5">
            <FieldError fieldId={FUND_NAME_FIELD} message={errors[FUND_NAME_FIELD]} />
          </div>
        </div>

        <div>
          <Label htmlFor="fund-desc">Short description (optional)</Label>
          <Textarea
            id="fund-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is this fund for?"
            rows={2}
            className="mt-1.5 text-base"
          />
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            {isLeader ? (
              <>
                <Label htmlFor="fund-recipient">Who receives it?</Label>
                <Combobox
                  items={memberIds}
                  itemToStringLabel={memberLabel}
                  value={stewardId}
                  onValueChange={(v) => {
                    if (!v) return;
                    setStewardId(v);
                    if (v === coStewardId) setCoStewardId(NONE);
                  }}
                >
                  <ComboboxInput
                    id="fund-recipient"
                    placeholder="Search members…"
                    className="mt-1.5 h-12"
                  />
                  <ComboboxPopup>
                    <ComboboxEmpty />
                    <ComboboxList>
                      {(id: string) => (
                        <ComboboxItem key={id} value={id} className="min-h-11">
                          {memberLabel(id)}
                        </ComboboxItem>
                      )}
                    </ComboboxList>
                  </ComboboxPopup>
                </Combobox>
              </>
            ) : (
              <>
                <p className="text-base leading-none font-medium">Who receives it?</p>
                <p className="mt-1.5 rounded-lg border border-border bg-background px-3 py-2.5 text-base">
                  {steward?.name ?? "You"}
                </p>
              </>
            )}
            <p className="mt-1.5 text-base text-muted-foreground">
              Money goes to this person&apos;s accounts.
            </p>
          </div>
          <div>
            <Label htmlFor="fund-second-person">Second person (optional)</Label>
            <Combobox
              items={coMemberIds}
              itemToStringLabel={memberLabel}
              value={coStewardId}
              onValueChange={(v) => setCoStewardId(v ?? NONE)}
            >
              <ComboboxInput
                id="fund-second-person"
                placeholder="Search members…"
                className="mt-1.5 h-12"
              />
              <ComboboxPopup>
                <ComboboxEmpty />
                <ComboboxList>
                  {(id: string) => (
                    <ComboboxItem key={id} value={id} className="min-h-11">
                      {memberLabel(id)}
                    </ComboboxItem>
                  )}
                </ComboboxList>
              </ComboboxPopup>
            </Combobox>
            <p className="mt-1.5 text-base text-muted-foreground">
              Named beside them on the fund, such as a spouse.
            </p>
          </div>
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <Label htmlFor="fund-role">Their role (optional)</Label>
            <Input
              id="fund-role"
              value={stewardRole}
              onChange={(e) => setStewardRole(e.target.value)}
              placeholder="Treasurer"
              maxLength={60}
              className="mt-1.5"
            />
            <p className="mt-1.5 text-base text-muted-foreground">
              Shown after their name.
            </p>
          </div>
          <div>
            <Label htmlFor="fund-retire">Retire on (optional)</Label>
            <Input
              id="fund-retire"
              type="date"
              value={retireOn}
              onChange={(e) => setRetireOn(e.target.value)}
              className="mt-1.5"
            />
            <p className="mt-1.5 text-base text-muted-foreground">
              Hidden from the Give page after this date.
            </p>
          </div>
        </div>

        <fieldset>
          <legend className="text-base font-medium">Payment methods</legend>
          <p className="mt-1 text-base text-muted-foreground">
            Turn on each way members can give, then enter the account to send to.
          </p>
          <div className="mt-2">
            <FieldError fieldId={METHODS_FIELD} message={errors[METHODS_FIELD]} />
          </div>
          <div className="mt-2 space-y-2">
            {METHOD_ORDER.map((key) => {
              const meta = PAYMENT_METHODS[key];
              const m = methods[key];
              const accountField = methodAccountField(key);
              const toggleField = methodToggleField(key);
              return (
                <div
                  key={key}
                  className={`rounded-xl border px-3.5 py-2 ${
                    m.enabled ? "border-brand-primary/40 bg-card" : "border-border bg-background"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <MethodChip method={meta} size="sm" />
                    <span className="flex-1 text-base font-semibold">{meta.name}</span>
                    <span aria-hidden="true" className="text-base text-muted-foreground">
                      {m.enabled ? "On" : "Off"}
                    </span>
                    <Switch
                      id={toggleField}
                      checked={m.enabled}
                      onCheckedChange={(on) => setMethod(key, { enabled: on })}
                      aria-label={`Accept ${meta.name}`}
                      className={CLEAR_OFF_TRACK}
                      {...invalidFieldProps(toggleField, errors[toggleField])}
                    />
                  </div>
                  {m.enabled && (
                    <div className="mt-1 pb-1.5">
                      <Label htmlFor={accountField}>{meta.name} account</Label>
                      <Input
                        id={accountField}
                        value={m.custom}
                        onChange={(e) => setMethod(key, { custom: e.target.value })}
                        placeholder={meta.placeholder}
                        maxLength={120}
                        className="mt-1.5"
                        {...invalidFieldProps(accountField, errors[accountField])}
                      />
                      <div className="mt-1.5">
                        <FieldError fieldId={accountField} message={errors[accountField]} />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </fieldset>

        <div className="flex flex-wrap gap-3 border-t border-border pt-6">
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : fund ? "Save changes" : "Add fund"}
          </Button>
          <Button variant="outline" onClick={() => router.push(backHref)}>
            Cancel
          </Button>
        </div>

        {fund && (
          <div className="flex flex-wrap gap-3">
            <Button variant="outline" onClick={() => setLive(!isLive)}>
              {isLive ? "Retire fund" : "Reopen fund"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => setConfirmingDelete(true)}
              className="text-destructive hover:text-destructive"
            >
              Delete fund
            </Button>
            <ConfirmDialog
              open={confirmingDelete}
              onOpenChange={setConfirmingDelete}
              title={`Delete ${fund.name}?`}
              description="The fund and its payment methods are removed. This can't be undone."
              confirmLabel="Delete fund"
              pendingLabel="Deleting…"
              onConfirm={remove}
            />
          </div>
        )}
      </div>

      {/* Live preview — how the fund reads on the Give page */}
      <div className="lg:sticky lg:top-6">
        <p className="mb-3 text-base font-semibold text-foreground">How members see it</p>
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            {steward && (
              <AvatarCluster
                people={[steward, ...(coSteward ? [coSteward] : [])].map(
                  (p) => ({
                    avatarUrl: p.avatarUrl,
                    name: p.name,
                    initials: p.initials,
                  })
                )}
              />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xl font-semibold">
                  {name.trim() || "Fund name"}
                </span>
                {previewTag && (
                  <span className="rounded-full bg-brand-bg-light px-2.5 py-0.5 text-sm font-semibold">
                    {previewTag}
                  </span>
                )}
              </div>
              {stewardNames && (
                <p className="text-base text-muted-foreground">
                  {fundRecipientLine(stewardNames, stewardRole.trim() || null)}
                </p>
              )}
            </div>
          </div>
          {description.trim() && (
            <p className="mt-3 text-base text-muted-foreground">
              {description.trim()}
            </p>
          )}
          <div className="mt-3.5 space-y-2">
            {previewMethods.length > 0 ? (
              previewMethods.map((m) => (
                <MethodButton key={m.method} resolved={m} />
              ))
            ) : (
              <p className="text-base text-muted-foreground">
                Turn on a payment method to see it here.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
