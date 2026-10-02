"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { setGroupMembership } from "@/lib/memberGroups";
import type { MemberGroup } from "@/lib/types";

interface MemberGroupsSectionProps {
  profileId: string;
}

/**
 * Admin-only section within the member edit page.
 * Displays all member groups as checkboxes — toggling a group
 * assigns or removes the member from that group. Denormalized role
 * flags on profiles are kept in sync by database triggers.
 */
export function MemberGroupsSection({ profileId }: MemberGroupsSectionProps) {
  const [groups, setGroups] = useState<MemberGroup[]>([]);
  const [assigned, setAssigned] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    async function load() {
      const [{ data: allGroups, error: groupsErr }, { data: profileGroups, error: pgErr }] = await Promise.all([
        supabase
          .from("teams")
          .select("*")
          .order("display_order"),
        supabase
          .from("team_members")
          .select("team_id")
          .eq("profile_id", profileId),
      ]);

      if (groupsErr || pgErr) {
        toast.error("Failed to load groups.");
        setLoading(false);
        return;
      }

      setGroups((allGroups || []) as MemberGroup[]);
      setAssigned(
        new Set((profileGroups || []).map((pg: { team_id: string }) => pg.team_id)),
      );
      setLoading(false);
    }
    load();
  }, [profileId, supabase]);

  async function handleToggle(group: MemberGroup, checked: boolean) {
    setToggling(group.id);

    const errorMessage = await setGroupMembership(profileId, group, checked);
    if (errorMessage) {
      toast.error(errorMessage);
      setToggling(null);
      return;
    }

    setAssigned((prev) => {
      const next = new Set(prev);
      if (checked) next.add(group.id);
      else next.delete(group.id);
      return next;
    });
    toast.success(checked ? `Added to ${group.name}.` : `Removed from ${group.name}.`);
    setToggling(null);
  }

  if (loading) return null;
  if (groups.length === 0) return null;

  return (
    <div className="mt-6">
      <h2 className="text-xl font-semibold mb-3">Groups</h2>
      <Card>
        <CardContent className="pt-5 space-y-4">
          {groups.map((group) => (
            <div key={group.id} className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-2">
                {group.color && (
                  <div
                    className="w-3 h-3 rounded-full shrink-0 mt-0.5"
                    style={{ backgroundColor: group.color }}
                  />
                )}
                <div>
                  <Label
                    htmlFor={`group-${group.id}`}
                    className="text-base cursor-pointer"
                  >
                    {group.name}
                  </Label>
                  {group.description && (
                    <p className="text-sm text-muted-foreground">
                      {group.description}
                    </p>
                  )}
                </div>
              </div>
              <Switch
                id={`group-${group.id}`}
                checked={assigned.has(group.id)}
                disabled={toggling === group.id}
                onCheckedChange={(v) => handleToggle(group, v)}
              />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
