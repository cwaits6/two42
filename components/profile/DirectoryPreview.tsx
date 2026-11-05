"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { mintSignedUrl, mintSignedUrls } from "@/lib/uploadImage";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { failureMessage } from "@/lib/errorCopy";
import { PersonCard } from "@/components/directory/PersonCard";
import { PROFILE_COLUMNS, type ProfileColumns } from "@/lib/profileColumns";
import type {
  DirectoryProfile,
  FamilyDirectoryFull,
  GroupChip,
  Profile,
} from "@/lib/types";

/**
 * The profile as the profiles_directory SQL view returns it, so the preview
 * shows exactly what other members see.
 */
function directoryEntry(p: Profile, groups: GroupChip[]): DirectoryProfile {
  return {
    id: p.id,
    first_name: p.first_name,
    last_name: p.last_name,
    preferred_name: p.preferred_name,
    avatar_url: p.avatar_url,
    role: p.role,
    relationship: p.relationship,
    bio: p.bio,
    family_id: p.family_id,
    email: p.hide_email ? null : p.email,
    phone_mobile: p.phone_mobile,
    phone_home: p.phone_home,
    phone_work: p.phone_work,
    address_line1: p.address_line1,
    address_line2: p.address_line2,
    city: p.city,
    state: p.state,
    postal_code: p.postal_code,
    birth_month: p.birth_month,
    birth_day: p.birth_day,
    birth_year: p.birth_year,
    occupation: p.occupation,
    employer: p.employer,
    groups,
    created_at: p.created_at,
  };
}

/**
 * "How others see me" — opens a sheet rendering the exact directory profile
 * card with the member's email setting applied.
 */
export function DirectoryPreview() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [entry, setEntry] = useState<DirectoryProfile | null>(null);
  const [unlisted, setUnlisted] = useState(false);
  const [family, setFamily] = useState<FamilyDirectoryFull | null>(null);
  const supabase = createClient();

  async function openPreview() {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }

    // Fetch fresh so the preview reflects the latest saved profile
    const [{ data: row, error }, { data: ownEmail, error: emailError }, { data: groupRows }] = await Promise.all([
      supabase.from("profiles").select(PROFILE_COLUMNS).eq("id", user.id).single<ProfileColumns>(),
      supabase.rpc("get_own_email"),
      supabase
        .from("team_members")
        .select("teams(id, name, color, icon, display_order)")
        .eq("profile_id", user.id),
    ]);

    if (error || emailError || !row) {
      toast.error(failureMessage("load your directory entry"));
      setLoading(false);
      return;
    }
    const profile = { ...row, email: ownEmail };

    const groups = (groupRows || [])
      .map((r) => r.teams as unknown as (GroupChip & { display_order: number }) | null)
      .filter((g): g is GroupChip & { display_order: number } => !!g)
      .sort((a, b) => a.display_order - b.display_order);

    let familyRow: FamilyDirectoryFull | null = null;
    // Unlisted profiles render the hidden state — no family card to fetch
    if (!profile.is_unlisted && profile.family_id) {
      const { data: f } = await supabase
        .from("families_directory_full")
        .select("*")
        .eq("id", profile.family_id)
        .maybeSingle<FamilyDirectoryFull>();
      familyRow = f ?? null;
    }

    // Private buckets: exchange stored URLs for signed ones before
    // they reach the PersonCard/FamilyCard renders.
    profile.avatar_url = await mintSignedUrl(profile.avatar_url);
    if (familyRow) {
      const members = familyRow.members ?? [];
      const familyMembers = familyRow.family_members_list ?? [];
      const signed = await mintSignedUrls([
        familyRow.photo_url,
        ...members.map((m) => m.avatar_url),
        ...familyMembers.map((fm) => fm.avatar_url),
      ]);
      familyRow = {
        ...familyRow,
        photo_url: signed[0],
        members: members.map((m, i) => ({ ...m, avatar_url: signed[1 + i] })),
        family_members_list: familyMembers.map((fm, i) => ({
          ...fm,
          avatar_url: signed[1 + members.length + i],
        })),
      };
    }

    setUnlisted(profile.is_unlisted);
    setEntry(profile.is_unlisted ? null : directoryEntry(profile, groups));
    setFamily(familyRow);
    setLoading(false);
    setOpen(true);
  }

  return (
    <>
      <Button
        variant="outline"
        onClick={openPreview}
        disabled={loading}
        className="gap-2"
      >
        <Eye className="h-5 w-5" aria-hidden="true" />
        {loading ? "Loading…" : "Preview my directory entry"}
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-md flex flex-col overflow-hidden p-0"
        >
          <SheetHeader className="px-4 pt-4 pb-3 border-b shrink-0">
            <SheetTitle>How others see you</SheetTitle>
          </SheetHeader>

          {unlisted ? (
            <div className="px-4 py-8 text-center space-y-2">
              <EyeOff className="h-8 w-8 mx-auto text-muted-foreground" aria-hidden="true" />
              <p className="font-medium">You&apos;re hidden from the directory.</p>
              <p className="text-base text-muted-foreground">
                To appear to other members, uncheck &ldquo;Hide me from the
                directory&rdquo; on your profile and save.
              </p>
            </div>
          ) : (
            entry && (
              <div className="px-4 pb-6 pt-2 overflow-y-auto flex-1">
                <PersonCard profile={entry} family={family} />
              </div>
            )
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
