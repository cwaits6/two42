"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Combobox,
  ComboboxInput,
  ComboboxPopup,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
} from "@/components/ui/combobox";
import { toast } from "sonner";
import { AvatarCluster } from "@/components/directory/AvatarCluster";
import { PostingTo } from "@/components/groups/PostingTo";
import { MethodButton, MethodChip } from "@/components/giving/MethodButton";
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
}

type MethodState = Record<PaymentMethodKey, { enabled: boolean; custom: string }>;

const NONE = "none";

export function FundForm({
  fund,
  members,
  currentUserId,
  isLeader,
  groupId,
  groupName,
  backHref,
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
  const [methods, setMethods] = useState<MethodState>(() => {
    const state = {} as MethodState;
    for (const key of METHOD_ORDER) {
      const existing = fund?.methods.find((m) => m.method === key);
      state[key] = {
        enabled: !!existing,
        custom: existing?.custom_handle ?? "",
      };
    }
    return state;
  });

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

  function setMethod(key: PaymentMethodKey, patch: Partial<MethodState[PaymentMethodKey]>) {
    setMethods((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }

  async function save() {
    if (!name.trim()) {
      toast.error("Give the fund a name.");
      return;
    }
    if (previewMethods.length === 0) {
      toast.error(
        "Turn on at least one payment method with a handle, or nobody can pay."
      );
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
        toast.error("Failed to save the fund.");
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
        toast.error("Failed to create the fund.");
        return;
      }
      fundId = data.id;
    }

    // Reconcile methods: upsert the usable rows first, then prune the
    // rest — a failed write never leaves the fund with no methods.
    // Enabled-but-blank methods are pruned too: without a handle there
    // is nothing to save (custom_handle is not null in the schema).
    const rows = METHOD_ORDER.flatMap((key, i) => {
      const m = methods[key];
      const handle = m.custom.trim();
      if (!m.enabled || !handle) return [];
      return [
        {
          fund_id: fundId,
          group_id: groupId,
          method: key,
          custom_handle: handle,
          display_order: i,
        },
      ];
    });
    const pruned = METHOD_ORDER.filter(
      (key) => !rows.some((r) => r.method === key)
    );
    const { error: upsertError } =
      rows.length > 0
        ? await supabase.from("giving_fund_methods").upsert(rows)
        : { error: null };
    const { error: delError } =
      !upsertError && pruned.length > 0
        ? await supabase
            .from("giving_fund_methods")
            .delete()
            .eq("fund_id", fundId)
            .eq("group_id", groupId)
            .in("method", pruned)
        : { error: null };

    setSaving(false);
    if (upsertError || delError) {
      toast.error("Fund saved, but payment methods failed to update.");
      return;
    }
    toast.success(fund ? "Fund updated." : "Fund created.");
    router.push(backHref);
    router.refresh();
  }

  async function setActive(active: boolean) {
    if (!fund) return;
    const { data, error } = await supabase
      .from("giving_funds")
      .update({ is_active: active, updated_at: new Date().toISOString() })
      .eq("id", fund.id)
      .eq("group_id", groupId)
      .select("id");
    if (error || !data?.length) {
      toast.error("Failed to update the fund.");
      return;
    }
    toast.success(active ? "Fund reactivated." : "Fund retired.");
    router.push(backHref);
    router.refresh();
  }

  async function remove() {
    if (!fund) return;
    if (!window.confirm(`Delete "${fund.name}"? This can't be undone.`)) return;
    const { data, error } = await supabase
      .from("giving_funds")
      .delete()
      .eq("id", fund.id)
      .eq("group_id", groupId)
      .select("id");
    if (error || !data?.length) {
      toast.error("Failed to delete the fund.");
      return;
    }
    toast.success("Fund deleted.");
    router.push(backHref);
    router.refresh();
  }

  const previewTag = retireOn
    ? `Through ${new Date(retireOn + "T00:00:00Z").toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      })}`
    : null;

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_340px] lg:items-start">
      <div className="rounded-2xl border border-border bg-card p-6 sm:p-7">
        <div className="space-y-5">
          {!fund && <PostingTo groupName={groupName} />}
          <div>
            <Label htmlFor="fund-name" className="text-base">
              Fund name
            </Label>
            <Input
              id="fund-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Flowers for Delores"
              maxLength={80}
              className="mt-1.5 text-base py-5"
            />
          </div>

          <div>
            <Label htmlFor="fund-desc" className="text-base">
              Short description
            </Label>
            <Textarea
              id="fund-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this collection for?"
              rows={2}
              className="mt-1.5 text-base"
            />
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <Label className="text-base">Who receives it?</Label>
              {isLeader ? (
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
                    placeholder="Search members…"
                    className="mt-1.5 text-base py-2.5"
                  />
                  <ComboboxPopup>
                    <ComboboxEmpty />
                    <ComboboxList>
                      {(id: string) => (
                        <ComboboxItem key={id} value={id}>
                          {memberLabel(id)}
                        </ComboboxItem>
                      )}
                    </ComboboxList>
                  </ComboboxPopup>
                </Combobox>
              ) : (
                <p className="mt-1.5 rounded-md border border-border bg-background px-3 py-2.5 text-base">
                  {steward?.name ?? "You"}
                </p>
              )}
              <p className="mt-1.5 text-sm text-muted-foreground">
                Money goes to this person&apos;s accounts.
              </p>
            </div>
            <div>
              <Label className="text-base">Shown with (optional)</Label>
              <Combobox
                items={coMemberIds}
                itemToStringLabel={memberLabel}
                value={coStewardId}
                onValueChange={(v) => setCoStewardId(v ?? NONE)}
              >
                <ComboboxInput
                  placeholder="Search members…"
                  className="mt-1.5 text-base py-2.5"
                />
                <ComboboxPopup>
                  <ComboboxEmpty />
                  <ComboboxList>
                    {(id: string) => (
                      <ComboboxItem key={id} value={id}>
                        {memberLabel(id)}
                      </ComboboxItem>
                    )}
                  </ComboboxList>
                </ComboboxPopup>
              </Combobox>
              <p className="mt-1.5 text-sm text-muted-foreground">
                A spouse or co-collector, for display.
              </p>
            </div>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <Label htmlFor="fund-role" className="text-base">
                Role label (optional)
              </Label>
              <Input
                id="fund-role"
                value={stewardRole}
                onChange={(e) => setStewardRole(e.target.value)}
                placeholder="Care team, Treasurer…"
                maxLength={60}
                className="mt-1.5 text-base py-5"
              />
            </div>
            <div>
              <Label htmlFor="fund-retire" className="text-base">
                Auto-retire on (optional)
              </Label>
              <Input
                id="fund-retire"
                type="date"
                value={retireOn}
                onChange={(e) => setRetireOn(e.target.value)}
                className="mt-1.5 text-base py-5"
              />
              <p className="mt-1.5 text-sm text-muted-foreground">
                Hidden from the Give page after this date.
              </p>
            </div>
          </div>

          <div>
            <Label className="text-base">Payment methods</Label>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Enter a payment handle for each method.
            </p>
            <div className="mt-3 space-y-2">
              {METHOD_ORDER.map((key) => {
                const meta = PAYMENT_METHODS[key];
                const m = methods[key];
                const missing = m.enabled && !m.custom.trim();
                return (
                  <div
                    key={key}
                    className={`rounded-xl border px-3.5 py-3 transition-opacity ${
                      m.enabled
                        ? "border-border bg-card"
                        : "border-transparent bg-background opacity-60"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <MethodChip method={meta} size="sm" />
                      <span className="flex-1 text-base font-semibold">
                        {meta.name}
                      </span>
                      <Switch
                        checked={m.enabled}
                        onCheckedChange={(on) => setMethod(key, { enabled: on })}
                        aria-label={`Accept ${meta.name}`}
                      />
                    </div>
                    {m.enabled && (
                      <div className="mt-2.5 pl-10">
                        <Input
                          value={m.custom}
                          onChange={(e) => setMethod(key, { custom: e.target.value })}
                          placeholder={meta.placeholder}
                          maxLength={120}
                          className="font-mono text-sm"
                        />
                        {missing && (
                          <p className="mt-1.5 text-sm font-medium text-brand-accent">
                            Enter a handle for {meta.name}{' '}or this method won&apos;t be saved.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-5">
            <Button
              onClick={save}
              disabled={saving}
              className="bg-brand-primary hover:bg-brand-primary/90 text-white"
            >
              {saving ? "Saving…" : fund ? "Save changes" : "Create fund"}
            </Button>
            <Button variant="outline" onClick={() => router.push(backHref)}>
              Cancel
            </Button>
            {fund && (
              <div className="ml-auto flex items-center gap-3">
                <Button
                  variant="outline"
                  onClick={() => setActive(!fund.is_active)}
                >
                  {fund.is_active ? "Retire fund" : "Reactivate fund"}
                </Button>
                <Button
                  variant="ghost"
                  onClick={remove}
                  className="text-destructive hover:text-destructive"
                >
                  Delete
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Live preview — how the fund reads on the Give page */}
      <div className="lg:sticky lg:top-6">
        <p className="mb-3 flex items-center gap-2.5 text-xs font-bold uppercase tracking-widest text-brand-accent">
          <span className="h-px w-6 bg-brand-accent" aria-hidden="true" />
          How members see it
        </p>
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
                <span className="text-lg font-semibold">
                  {name.trim() || "Fund name"}
                </span>
                {previewTag && (
                  <span className="rounded-full bg-brand-bg-light px-2 py-0.5 text-xs font-bold uppercase tracking-wide">
                    {previewTag}
                  </span>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {stewardNames}
                {stewardRole.trim() ? ` · ${stewardRole.trim()}` : ""}
              </p>
            </div>
          </div>
          {description.trim() && (
            <p className="mt-3 text-sm text-muted-foreground">
              {description.trim()}
            </p>
          )}
          <div className="mt-3.5 space-y-2">
            {previewMethods.length > 0 ? (
              previewMethods.map((m) => (
                <MethodButton key={m.method} resolved={m} />
              ))
            ) : (
              <p className="rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
                Turn on a payment method to make this fund payable.
              </p>
            )}
          </div>
        </div>
        {retireOn && (
          <p className="mt-3 text-sm text-muted-foreground">
            Auto-retires {previewTag?.replace("Through ", "")} — no cleanup
            needed.
          </p>
        )}
      </div>
    </div>
  );
}
