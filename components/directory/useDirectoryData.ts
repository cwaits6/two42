"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { mintSignedUrls } from "@/lib/uploadImage";
import type { DirectoryGroup } from "@/components/directory/types";
import type { DirectoryProfile, FamilyDirectoryFull } from "@/lib/types";

/**
 * Private buckets (CWA-59): exchange every stored avatar/photo URL in the
 * directory payload for a signed URL in one batch — member avatars, family
 * photos, and the avatars nested in each family's member lists.
 */
async function signDirectoryUrls(
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

/**
 * Loads the three directory data sources (member profiles, households,
 * groups) and derives the lookup maps shared by all directory sub-pages.
 */
export function useDirectoryData() {
  const [members, setMembers] = useState<DirectoryProfile[]>([]);
  const [families, setFamilies] = useState<FamilyDirectoryFull[]>([]);
  const [groups, setGroups] = useState<DirectoryGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    async function load() {
      const [{ data: m, error: mErr }, { data: f, error: fErr }, { data: g, error: gErr }] =
        await Promise.all([
          supabase
            .from("profiles_directory")
            .select("*")
            .order("last_name", { ascending: true }),
          supabase
            .from("families_directory_full")
            .select("*")
            .order("family_name", { ascending: true }),
          supabase
            .from("member_groups")
            .select("id, name, color, icon, description, show_in_directory_filter")
            .order("display_order"),
        ]);

      if (mErr || fErr || gErr) {
        const err = mErr ?? fErr ?? gErr;
        console.error("directory load error:", {
          source: mErr
            ? "profiles_directory"
            : fErr
              ? "families_directory_full"
              : "member_groups",
          message: err?.message,
          details: err?.details,
          hint: err?.hint,
          code: err?.code,
        });
        setError(true);
        setLoading(false);
        return;
      }

      const signed = await signDirectoryUrls(
        (m || []) as DirectoryProfile[],
        (f || []) as FamilyDirectoryFull[],
      );
      setMembers(signed.members);
      setFamilies(signed.families);
      setGroups((g || []) as DirectoryGroup[]);
      setLoading(false);
    }
    load();
  }, [supabase]);

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

  // Roster per group, derived from listed members' group chips
  const groupRosters = useMemo(() => {
    const map: Record<string, DirectoryProfile[]> = {};
    for (const m of members) {
      for (const g of m.groups || []) {
        (map[g.id] ??= []).push(m);
      }
    }
    return map;
  }, [members]);

  return { members, families, groups, loading, error, profileMap, familyMap, groupRosters };
}
