"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { fetchAll } from "@/lib/supabase/fetchAll";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import {
  Plus,
  Pencil,
  Trash2,
  ArrowUp,
  ArrowDown,
  Users,
  HandHeart,
} from "lucide-react";
import type { MemberGroup, ServingTeamSettings } from "@/lib/types";
import { siteConfig } from "@/lib/config";
import { ServingSettingsDialog } from "@/components/serving/ServingSettingsDialog";
import { TeamRosterDialog } from "./TeamRosterDialog";
import { IconPicker } from "./IconPicker";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";

interface TeamFormState {
  name: string;
  description: string;
  color: string;
  icon: string;
  is_serving_role: boolean;
}

const EMPTY_FORM: TeamFormState = {
  name: "",
  description: "",
  color: siteConfig.colors.primary,
  icon: "users",
  is_serving_role: false,
};

function fromTeam(t: MemberGroup): TeamFormState {
  return {
    name: t.name,
    description: t.description || "",
    color: t.color || siteConfig.colors.primary,
    icon: t.icon || "users",
    is_serving_role: t.is_serving_role ?? false,
  };
}

type TeamSettings = Pick<ServingTeamSettings, "team_id" | "enabled" | "reminder_days" | "window_weeks">;

interface TeamsManagerProps {
  groupId: string;
  groupName: string;
}

export function TeamsManager({ groupId, groupName }: TeamsManagerProps) {
  const [teams, setTeams] = useState<MemberGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<MemberGroup | null>(null);
  const [rosterTeam, setRosterTeam] = useState<MemberGroup | null>(null);
  const [form, setForm] = useState<TeamFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [memberCounts, setMemberCounts] = useState<Record<string, number>>({});
  const [settingsByTeam, setSettingsByTeam] = useState<Record<string, TeamSettings>>({});

  const supabase = useMemo(() => createClient(), []);

  const loadTeams = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("teams")
      .select("*")
      .eq("group_id", groupId)
      .order("display_order");

    if (error) {
      toast.error("Failed to load teams.");
      setLoading(false);
      return;
    }

    const rows = (data || []) as MemberGroup[];
    setTeams(rows);
    const teamIds = rows.map((t) => t.id);

    if (teamIds.length === 0) {
      setMemberCounts({});
      setSettingsByTeam({});
      setLoading(false);
      return;
    }

    const [{ data: counts, error: countsError }, { data: settings, error: settingsError }] =
      await Promise.all([
        fetchAll((from, to) =>
          supabase
            .from("team_members")
            .select("team_id")
            .in("team_id", teamIds)
            .order("team_id")
            .order("profile_id")
            .range(from, to),
        ),
        supabase
          .from("serving_team_settings")
          .select("team_id, enabled, reminder_days, window_weeks")
          .in("team_id", teamIds),
      ]);
    // Keep the previous counts rather than showing every team as empty, which
    // would also silence the member warning on delete.
    if (countsError) {
      toast.error("Failed to load team members.");
      setLoading(false);
      return;
    }
    const countMap: Record<string, number> = {};
    (counts || []).forEach((row: { team_id: string }) => {
      countMap[row.team_id] = (countMap[row.team_id] || 0) + 1;
    });
    setMemberCounts(countMap);

    if (settingsError) {
      toast.error("Failed to load serving settings.");
      setLoading(false);
      return;
    }
    const settingsMap: Record<string, TeamSettings> = {};
    ((settings || []) as TeamSettings[]).forEach((row) => {
      settingsMap[row.team_id] = row;
    });
    setSettingsByTeam(settingsMap);

    setLoading(false);
  }, [supabase, groupId]);

  useEffect(() => {
    loadTeams();
  }, [loadTeams]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  }

  function openEdit(team: MemberGroup) {
    setEditing(team);
    setForm(fromTeam(team));
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!form.name.trim()) {
      toast.error("Team name is required.");
      return;
    }

    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      color: form.color || null,
      icon: form.icon || null,
      is_serving_role: form.is_serving_role,
    };

    setSaving(true);
    if (editing) {
      const { data, error } = await supabase
        .from("teams")
        .update(payload)
        .eq("id", editing.id)
        .eq("group_id", groupId)
        .select("id");
      setSaving(false);
      if (error || !data?.length) {
        toast.error("Failed to update team.");
        return;
      }
      toast.success("Team updated.");
    } else {
      const nextOrder =
        teams.length > 0
          ? Math.max(...teams.map((t) => t.display_order)) + 1
          : 0;
      const { error } = await supabase
        .from("teams")
        .insert({ ...payload, group_id: groupId, display_order: nextOrder });
      setSaving(false);
      if (error) {
        toast.error("Failed to create team.");
        return;
      }
      toast.success("Team created.");
    }

    setDialogOpen(false);
    loadTeams();
  }

  async function handleDelete(team: MemberGroup) {
    const count = memberCounts[team.id] || 0;
    const warning =
      count > 0
        ? `"${team.name}" has ${count} member(s). They will be removed from this team. `
        : "";
    if (!confirm(`${warning}Delete "${team.name}"?`)) return;

    const { data, error } = await supabase
      .from("teams")
      .delete()
      .eq("id", team.id)
      .eq("group_id", groupId)
      .select("id");

    if (error || !data?.length) {
      toast.error("Failed to delete team.");
      return;
    }
    toast.success("Team deleted.");
    setDialogOpen(false);
    loadTeams();
  }

  async function moveTeam(team: MemberGroup, direction: "up" | "down") {
    const idx = teams.findIndex((t) => t.id === team.id);
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= teams.length) return;

    const swapTeam = teams[swapIdx];
    const newOrder = team.display_order;
    const swapOrder = swapTeam.display_order;

    const [r1, r2] = await Promise.all([
      supabase
        .from("teams")
        .update({ display_order: swapOrder })
        .eq("id", team.id)
        .eq("group_id", groupId)
        .select("id"),
      supabase
        .from("teams")
        .update({ display_order: newOrder })
        .eq("id", swapTeam.id)
        .eq("group_id", groupId)
        .select("id"),
    ]);

    if (r1.error || r2.error || !r1.data?.length || !r2.data?.length) {
      toast.error("Failed to reorder.");
      return;
    }
    loadTeams();
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
        title="Teams"
        subtitle={`Greeters, Prayer Team and other serving teams in ${groupName}.`}
        actions={
          <Button
            size="lg"
            onClick={openCreate}
            className="bg-brand-primary hover:bg-brand-primary/90 text-white"
          >
            <Plus className="mr-2 h-5 w-5" />
            New team
          </Button>
        }
      />

      {teams.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-base text-muted-foreground">No teams yet.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {teams.map((team, idx) => (
            <Card
              key={team.id}
              onClick={() => setRosterTeam(team)}
              className="cursor-pointer transition-shadow hover:shadow-md"
            >
              <CardContent className="pt-5 pb-5">
                <div className="flex items-center gap-4">
                  <div
                    className="w-4 h-4 rounded-full shrink-0"
                    style={{ backgroundColor: team.color || "var(--color-brand-neutral)" }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold">{team.name}</p>
                      {team.is_serving_role && (
                        <Badge variant="secondary" className="text-xs gap-1">
                          <HandHeart className="h-3 w-3" />
                          Serving role
                        </Badge>
                      )}
                    </div>
                    {team.description && (
                      <p className="text-sm text-muted-foreground">
                        {team.description}
                      </p>
                    )}
                    <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                      <Users className="h-3 w-3" />
                      <span>
                        {memberCounts[team.id] || 0} member
                        {(memberCounts[team.id] || 0) !== 1 ? "s" : ""}
                      </span>
                    </div>
                  </div>
                  <div
                    className="flex items-center gap-1 shrink-0 flex-wrap justify-end"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={idx === 0}
                      onClick={() => moveTeam(team, "up")}
                      aria-label="Move up"
                    >
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={idx === teams.length - 1}
                      onClick={() => moveTeam(team, "down")}
                      aria-label="Move down"
                    >
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                    {team.is_serving_role && (
                      <ServingSettingsDialog
                        teamId={team.id}
                        settings={settingsByTeam[team.id] ?? null}
                      />
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setRosterTeam(team)}
                    >
                      <Users className="mr-1 h-4 w-4" />
                      Members
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openEdit(team)}
                    >
                      <Pencil className="mr-1 h-4 w-4" />
                      Edit
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <TeamRosterDialog
        team={rosterTeam}
        groupId={groupId}
        groupName={groupName}
        onClose={() => setRosterTeam(null)}
        onCountChange={(teamId, count) =>
          setMemberCounts((prev) => ({ ...prev, [teamId]: count }))
        }
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit team" : "New team"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="t_name">Team name</Label>
              <Input
                id="t_name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Prayer Team"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="t_desc">Description</Label>
              <Textarea
                id="t_desc"
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
                rows={2}
                placeholder="Optional description"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="t_color">Color</Label>
              <div className="flex items-center gap-2">
                <input
                  id="t_color"
                  type="color"
                  value={form.color}
                  onChange={(e) =>
                    setForm({ ...form, color: e.target.value })
                  }
                  className="h-9 w-9 cursor-pointer rounded border border-input"
                />
                <Input
                  value={form.color}
                  onChange={(e) =>
                    setForm({ ...form, color: e.target.value })
                  }
                  placeholder={siteConfig.colors.primary}
                  className="font-mono text-sm w-32"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Icon</Label>
              <IconPicker
                value={form.icon}
                onChange={(v) => setForm({ ...form, icon: v })}
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="t_serving">Serving role</Label>
                <p className="text-xs text-muted-foreground">
                  Lists this team on the Serving page with a roster everyone
                  can see. Turn on Sunday signups separately from that page.
                </p>
              </div>
              <Switch
                id="t_serving"
                checked={form.is_serving_role}
                onCheckedChange={(v) =>
                  setForm({ ...form, is_serving_role: v })
                }
              />
            </div>
          </div>

          <DialogFooter className="flex sm:justify-between">
            {editing && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => handleDelete(editing)}
              >
                <Trash2 className="mr-1 h-4 w-4" />
                Delete
              </Button>
            )}
            <div className="flex gap-2 sm:ml-auto">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving}
                className="bg-brand-primary hover:bg-brand-primary/90 text-white"
              >
                {saving ? "Saving..." : editing ? "Save changes" : "Create"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
