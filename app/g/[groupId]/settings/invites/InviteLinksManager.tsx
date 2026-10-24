"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Copy, Plus } from "lucide-react";
import { toast } from "sonner";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { siteConfig } from "@/lib/config";
import { groupPath } from "@/lib/groups/active";
import {
  DEFAULT_EXPIRY_PRESET,
  DEFAULT_USE_PRESET,
  EXPIRY_PRESETS,
  expiresAtFromPreset,
  expiryLabel,
  INVITE_STATUS_LABELS,
  inviteStatus,
  inviteUrl,
  maxUsesFromPreset,
  parseExpiryPreset,
  parseUsePreset,
  USE_PRESETS,
  usesLabel,
  type ExpiryPreset,
  type UsePreset,
} from "@/lib/groups/invites";
import { displayName } from "@/lib/names";
import { createClient } from "@/lib/supabase/client";
import { fetchAll } from "@/lib/supabase/fetchAll";
import type { GroupInvite } from "@/lib/types";

const EMPTY_TEXT = "No invite links yet. Create one and share it by text or email.";

interface InviteLinksManagerProps {
  groupId: string;
  groupName: string;
}

type Creator = { id: string; first_name: string | null; last_name: string | null; preferred_name: string | null };

export function InviteLinksManager({ groupId, groupName }: InviteLinksManagerProps) {
  const supabase = useMemo(() => createClient(), []);
  const [invites, setInvites] = useState<GroupInvite[]>([]);
  const [useCounts, setUseCounts] = useState<Record<string, number>>({});
  const [creators, setCreators] = useState<Record<string, Creator>>({});
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [expiry, setExpiry] = useState<ExpiryPreset>(DEFAULT_EXPIRY_PRESET);
  const [uses, setUses] = useState<UsePreset>(DEFAULT_USE_PRESET);
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<GroupInvite | null>(null);
  const [revokeBusy, setRevokeBusy] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const copyButtons = useRef<Record<string, HTMLButtonElement | null>>({});

  // Only the first load shows the placeholder: a refresh after create or
  // revoke keeps the list mounted, so focus can land on the new link's button.
  const load = useCallback(async () => {
    const [inviteRows, useRows] = await Promise.all([
      supabase
        .from("group_invites")
        .select("*")
        .eq("group_id", groupId)
        .order("created_at", { ascending: false }),
      fetchAll((from, to) =>
        supabase
          .from("group_invite_uses")
          .select("invite_id")
          .eq("group_id", groupId)
          .order("id")
          .range(from, to),
      ),
    ]);
    if (inviteRows.error || useRows.error) {
      console.error("Failed to load invite links:", inviteRows.error ?? useRows.error);
      setLoadFailed(true);
      setLoading(false);
      return;
    }
    const rows: GroupInvite[] = inviteRows.data ?? [];
    const counts: Record<string, number> = {};
    for (const row of useRows.data ?? []) {
      counts[row.invite_id] = (counts[row.invite_id] ?? 0) + 1;
    }
    const creatorIds = [...new Set(rows.map((r) => r.created_by).filter((id): id is string => id !== null))];
    let creatorRows: Creator[] = [];
    if (creatorIds.length > 0) {
      // A creator outside the leader's groups reads as no row and falls back
      // to "a leader"; the name is a courtesy, not a gate.
      const { data } = await supabase
        .from("profiles")
        .select("id, first_name, last_name, preferred_name")
        .in("id", creatorIds);
      creatorRows = (data ?? []) as Creator[];
    }
    setInvites(rows);
    setUseCounts(counts);
    setCreators(Object.fromEntries(creatorRows.map((c) => [c.id, c])));
    setLoadFailed(false);
    setLoading(false);
  }, [supabase, groupId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!focusId) return;
    copyButtons.current[focusId]?.focus();
    setFocusId(null);
  }, [focusId, invites]);

  async function copyLink(invite: GroupInvite) {
    try {
      await navigator.clipboard.writeText(inviteUrl(siteConfig.url, invite.token));
      toast.success("Link copied.");
    } catch {
      toast.error("Couldn't copy the link. Select it and copy it by hand.");
    }
  }

  async function createLink() {
    setCreating(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setCreating(false);
      toast.error("Sign in again to create a link.");
      return;
    }
    const now = new Date();
    const { data, error } = await supabase
      .from("group_invites")
      .insert({
        group_id: groupId,
        created_by: user.id,
        expires_at: expiresAtFromPreset(expiry, now),
        max_uses: maxUsesFromPreset(uses),
      })
      .select("*")
      .single();
    setCreating(false);
    if (error || !data) {
      toast.error("Couldn't create the link.");
      return;
    }
    const created: GroupInvite = data;
    setInvites((prev) => [created, ...prev]);
    setCreateOpen(false);
    setExpiry(DEFAULT_EXPIRY_PRESET);
    setUses(DEFAULT_USE_PRESET);
    toast.success("Link created.");
    setFocusId(created.id);
    load();
  }

  async function revokeLink() {
    if (!revoking) return;
    setRevokeBusy(true);
    const revokedAt = new Date().toISOString();
    const { data, error } = await supabase
      .from("group_invites")
      .update({ revoked_at: revokedAt })
      .eq("id", revoking.id)
      .eq("group_id", groupId)
      .select("id");
    setRevokeBusy(false);
    if (error || !data?.length) {
      toast.error("Couldn't revoke the link.");
      return;
    }
    setInvites((prev) => prev.map((i) => (i.id === revoking.id ? { ...i, revoked_at: revokedAt } : i)));
    setRevoking(null);
    toast.success("Link revoked.");
  }

  const now = new Date();
  const withStatus = invites.map((invite) => ({
    invite,
    status: inviteStatus(invite, useCounts[invite.id] ?? 0, now),
  }));
  const active = withStatus.filter((i) => i.status === "active");
  const past = withStatus.filter((i) => i.status !== "active");

  function meta(invite: GroupInvite): string {
    const creator = invite.created_by ? creators[invite.created_by] : undefined;
    return [
      expiryLabel(invite.expires_at, siteConfig.timeZone),
      usesLabel(useCounts[invite.id] ?? 0, invite.max_uses),
      `Created by ${creator ? displayName(creator) : "a leader"}`,
    ].join(" · ");
  }

  if (loading) {
    return (
      <PageContainer>
        <p className="text-xl text-muted-foreground">Loading...</p>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title="Invite links"
        subtitle={groupName}
        backHref={groupPath(groupId, "/settings")}
        backLabel="Back to Group settings"
        actions={
          <Button
            size="lg"
            onClick={() => setCreateOpen(true)}
            className="bg-brand-primary text-white hover:bg-brand-primary/90"
          >
            <Plus className="mr-2 h-5 w-5" />
            Create link
          </Button>
        }
      />

      {loadFailed ? (
        <p role="alert" className="text-lg text-muted-foreground">
          Couldn&apos;t load the invite links. Reload the page to try again.
        </p>
      ) : invites.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-base text-muted-foreground">{EMPTY_TEXT}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-8">
          <section>
            <h2 className="mb-4 text-xl font-bold text-foreground">Active links</h2>
            {active.length === 0 ? (
              <p className="text-base text-muted-foreground">No active links.</p>
            ) : (
              <ul className="space-y-3">
                {active.map(({ invite }) => (
                  <li key={invite.id}>
                    <Card>
                      <CardContent className="space-y-4 pt-5 pb-5">
                        <p className="break-all font-mono text-base text-foreground">
                          {inviteUrl(siteConfig.url, invite.token)}
                        </p>
                        <p className="text-base text-muted-foreground">{meta(invite)}</p>
                        <div className="flex flex-wrap gap-3">
                          <Button
                            size="lg"
                            ref={(el) => {
                              copyButtons.current[invite.id] = el;
                            }}
                            onClick={() => copyLink(invite)}
                            className="bg-brand-primary text-white hover:bg-brand-primary/90"
                          >
                            <Copy className="mr-2 h-5 w-5" />
                            Copy link
                          </Button>
                          <Button size="lg" variant="outline" onClick={() => setRevoking(invite)}>
                            Revoke link
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {past.length > 0 ? (
            <section>
              <h2 className="mb-4 text-xl font-bold text-foreground">Past links</h2>
              <ul className="space-y-3">
                {past.map(({ invite, status }) => (
                  <li key={invite.id}>
                    <Card>
                      <CardContent className="space-y-2 pt-5 pb-5">
                        <p className="text-base font-semibold text-foreground">
                          {INVITE_STATUS_LABELS[status]}
                        </p>
                        <p className="break-all font-mono text-base text-muted-foreground">
                          {inviteUrl(siteConfig.url, invite.token)}
                        </p>
                        <p className="text-base text-muted-foreground">{meta(invite)}</p>
                      </CardContent>
                    </Card>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create invite link</DialogTitle>
            <DialogDescription className="text-base">
              Anyone with the link can join {groupName}. You can revoke it at any time.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-2">
            <div className="space-y-2">
              <Label htmlFor="invite-expiry" className="text-base">
                Expires
              </Label>
              <Select
                items={EXPIRY_PRESETS.map((p) => ({ value: p.value, label: p.label }))}
                value={expiry}
                onValueChange={(v) => setExpiry(parseExpiryPreset(v))}
              >
                <SelectTrigger id="invite-expiry" className="h-12 w-full text-base">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXPIRY_PRESETS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-uses" className="text-base">
                Uses
              </Label>
              <Select
                items={USE_PRESETS.map((p) => ({ value: p.value, label: p.label }))}
                value={uses}
                onValueChange={(v) => setUses(parseUsePreset(v))}
              >
                <SelectTrigger id="invite-uses" className="h-12 w-full text-base">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {USE_PRESETS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button size="lg" variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button
              size="lg"
              onClick={createLink}
              disabled={creating}
              className="bg-brand-primary text-white hover:bg-brand-primary/90"
            >
              {creating ? "Creating…" : "Create link"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={revoking !== null} onOpenChange={(open) => !open && setRevoking(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke this link?</DialogTitle>
            <DialogDescription className="text-base">
              Anyone who has it can no longer use it.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button size="lg" variant="outline" onClick={() => setRevoking(null)} disabled={revokeBusy}>
              Cancel
            </Button>
            <Button size="lg" variant="destructive" onClick={revokeLink} disabled={revokeBusy}>
              {revokeBusy ? "Revoking…" : "Revoke link"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
