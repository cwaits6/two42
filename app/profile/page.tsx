import { createClient } from "@/lib/supabase/server";
import { mintSignedUrls } from "@/lib/storageRead";
import { redirect } from "next/navigation";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { ProfileHouseholdTabs } from "@/components/profile/ProfileHouseholdTabs";
import { siteConfig } from "@/lib/config";
import { canEditSpouseProfiles as computeCanEditSpouseProfiles, type HouseholdSummary } from "@/lib/household";
import type { Profile, FamilyUnit, FamilyMember } from "@/lib/types";

export const metadata = { title: `My Profile | ${siteConfig.name}` };

export default async function ProfilePage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single<Profile>();

  if (!profile) redirect("/dashboard");
  if (!["member", "content_editor", "admin"].includes(profile.role)) {
    redirect("/dashboard");
  }

  // New members must complete the setup wizard before editing their profile
  if (!profile.setup_completed) {
    redirect("/profile/setup");
  }

  let family: FamilyUnit | null = null;
  let householdProfiles: (Profile | HouseholdSummary)[] = [];
  let familyMembers: FamilyMember[] = [];

  // Only primary/spouse can open the edit sheet for other household members,
  // so only they need full rows — everyone else only ever sees name/avatar/relationship.
  const canEditSpouseProfiles = computeCanEditSpouseProfiles(profile);

  if (profile.family_id) {
    const [familyRes, othersRes, fmsRes] = await Promise.all([
      supabase
        .from("family_units")
        .select("*")
        .eq("id", profile.family_id)
        .maybeSingle<FamilyUnit>(),
      // Other enrolled household members. Full rows only for viewers who can
      // open the edit sheet, so it can populate the form without a second
      // fetch; everyone else gets the narrow field list the list actually renders.
      canEditSpouseProfiles
        ? supabase
            .from("profiles")
            .select("*")
            .eq("family_id", profile.family_id)
            .neq("id", user.id)
            .order("first_name")
            .returns<Profile[]>()
        : supabase
            .from("profiles")
            .select("id, first_name, last_name, preferred_name, relationship, role, avatar_url")
            .eq("family_id", profile.family_id)
            .neq("id", user.id)
            .order("first_name")
            .returns<HouseholdSummary[]>(),
      // Family members without accounts (children etc.)
      supabase
        .from("family_members")
        .select("*")
        .eq("family_id", profile.family_id)
        .is("claimed_profile_id", null)
        .order("relationship")
        .returns<FamilyMember[]>(),
    ]);
    // Fail loudly rather than rendering an empty household over a query error.
    const queryError = familyRes.error ?? othersRes.error ?? fmsRes.error;
    if (queryError) {
      console.error("Failed to load household data:", queryError);
      throw new Error("Failed to load your household information.");
    }
    family = familyRes.data ?? null;
    householdProfiles = othersRes.data ?? [];
    familyMembers = fmsRes.data ?? [];
  }

  // Private buckets (CWA-59): exchange every stored avatar/photo URL for a
  // signed URL in one batch before the data reaches client renders. The
  // upload paths keep persisting raw URLs — this only touches what's shown.
  const signed = await mintSignedUrls([
    profile.avatar_url,
    family?.photo_url,
    ...householdProfiles.map((p) => p.avatar_url),
    ...familyMembers.map((fm) => fm.avatar_url),
  ]);
  profile.avatar_url = signed[0];
  if (family) family.photo_url = signed[1];
  householdProfiles.forEach((p, i) => {
    p.avatar_url = signed[2 + i];
  });
  familyMembers.forEach((fm, i) => {
    fm.avatar_url = signed[2 + householdProfiles.length + i];
  });

  return (
    <PageContainer>
      <PageHeader
        title="My Profile"
        subtitle="Manage your info and your household."
      />

      <ProfileHouseholdTabs
        profile={profile}
        family={family}
        householdProfiles={householdProfiles}
        familyMembers={familyMembers}
      />
    </PageContainer>
  );
}
