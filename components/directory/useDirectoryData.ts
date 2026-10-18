"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { mintSignedUrls } from "@/lib/uploadImage";
import type { GroupRosters } from "@/components/directory/scope";
import type { DirectoryProfile, FamilyDirectoryFull } from "@/lib/types";

/**
 * Private buckets: exchange every stored avatar/photo URL in the
 * directory payload for a signed URL in one batch — member avatars, family
 * photos, and the avatars nested in each family's member lists.
 *
 * Exported for unit testing only; not part of the hook's public surface.
 */
export async function signDirectoryUrls(
  memberRows: DirectoryProfile[],
  familyRows: FamilyDirectoryFull[],
): Promise<{ members: DirectoryProfile[]; families: FamilyDirectoryFull[] }> {
  const urls: Array<string | null> = [];
  const take = (url: string | null): number => urls.push(url) - 1;

  const memberSlots = memberRows.map((m) => take(m.avatar_url));
  const familySlots = familyRows.map((f) => ({
    photo: take(f.photo_url),
    members: (f.members ?? []).map((m) => take(m.avatar_url)),
    familyMembers: (f.family_members_list ?? []).map((fm) => take(fm.avatar_url)),
  }));

  const signed = await mintSignedUrls(urls);

  return {
    members: memberRows.map((m, i) => ({
      ...m,
      avatar_url: signed[memberSlots[i]],
    })),
    families: familyRows.map((f, i) => ({
      ...f,
      photo_url: signed[familySlots[i].photo],
      members: (f.members ?? []).map((m, j) => ({
        ...m,
        avatar_url: signed[familySlots[i].members[j]],
      })),
      family_members_list: (f.family_members_list ?? []).map((fm, j) => ({
        ...fm,
        avatar_url: signed[familySlots[i].familyMembers[j]],
      })),
    })),
  };
}

type RosterRow = { group_id: string; profile_id: string };

/**
 * Loads everything the directory shows — the profiles and households the
 * viewer may read, plus the rosters of the viewer's own groups — and
 * derives the lookup maps the tabs share. RLS decides what comes back;
 * the rosters are what the scope filter cuts it with.
 */
export function useDirectoryData(membershipGroupIds: readonly string[]) {
  const [members, setMembers] = useState<DirectoryProfile[]>([]);
  const [families, setFamilies] = useState<FamilyDirectoryFull[]>([]);
  const [rosterRows, setRosterRows] = useState<RosterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [generation, setGeneration] = useState(0);

  const supabase = useMemo(() => createClient(), []);
  const groupIdsKey = membershipGroupIds.join(",");

  useEffect(() => {
    let cancelled = false;
    const groupIds = groupIdsKey ? groupIdsKey.split(",") : [];

    async function load() {
      try {
        const [profilesResult, familiesResult, rostersResult] = await Promise.all([
          supabase
            .from("profiles_directory")
            .select("*")
            .order("last_name", { ascending: true }),
          supabase
            .from("families_directory_full")
            .select("*")
            .order("family_name", { ascending: true }),
          groupIds.length === 0
            ? Promise.resolve({ data: [] as RosterRow[], error: null })
            : supabase.from("group_members").select("group_id, profile_id").in("group_id", groupIds),
        ]);

        const failed = (
          [
            ["profiles_directory", profilesResult.error],
            ["families_directory_full", familiesResult.error],
            ["group_members", rostersResult.error],
          ] as const
        ).find(([, err]) => err);
        if (failed) {
          const [source, err] = failed;
          console.error("directory load error:", {
            source,
            message: err?.message,
            details: err?.details,
            hint: err?.hint,
            code: err?.code,
          });
          if (!cancelled) {
            setError(true);
            setLoading(false);
          }
          return;
        }

        const signed = await signDirectoryUrls(
          (profilesResult.data || []) as DirectoryProfile[],
          (familiesResult.data || []) as FamilyDirectoryFull[],
        );
        if (cancelled) return;
        setMembers(signed.members);
        setFamilies(signed.families);
        setRosterRows((rostersResult.data || []) as RosterRow[]);
        setError(false);
        setLoading(false);
      } catch (err) {
        console.error("directory load failed:", err);
        if (!cancelled) {
          setError(true);
          setLoading(false);
        }
      }
    }
    setLoading(true);
    load();
    return () => {
      cancelled = true;
    };
  }, [supabase, groupIdsKey, generation]);

  const reload = useCallback(() => setGeneration((n) => n + 1), []);

  const profileMap = useMemo(() => {
    const map: Record<string, DirectoryProfile> = {};
    members.forEach((m) => {
      map[m.id] = m;
    });
    return map;
  }, [members]);

  const familyMap = useMemo(() => {
    const map: Record<string, FamilyDirectoryFull> = {};
    families.forEach((f) => {
      map[f.id] = f;
    });
    return map;
  }, [families]);

  const groupRosters = useMemo(() => {
    const map: Record<string, Set<string>> = {};
    for (const row of rosterRows) {
      (map[row.group_id] ??= new Set()).add(row.profile_id);
    }
    return map as GroupRosters;
  }, [rosterRows]);

  const groupsByProfile = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const row of rosterRows) {
      (map[row.profile_id] ??= []).push(row.group_id);
    }
    return map;
  }, [rosterRows]);

  return {
    members,
    families,
    loading,
    error,
    reload,
    profileMap,
    familyMap,
    groupRosters,
    groupsByProfile,
  };
}
