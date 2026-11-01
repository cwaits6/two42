import { createClient } from "@/lib/supabase/server";
import { mintSignedUrls } from "@/lib/storageRead";
import { redirect } from "next/navigation";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { ErrorState } from "@/components/states/ErrorState";
import { ProfileHouseholdTabs } from "@/components/profile/ProfileHouseholdTabs";
import { canEditSpouseProfiles as computeCanEditSpouseProfiles, type HouseholdSummary } from "@/lib/household";
import type { Profile, FamilyUnit, FamilyMember } from "@/lib/types";
import { getOptionalUser } from "@/lib/supabase/current-user";
import { isMemberRole } from "@/lib/roles";
import { pageTitle } from "@/lib/pageTitle";

export const generateMetadata = () => pageTitle("My profile");

export default async function ProfilePage() {
  const supabase = await createClient();

  const user = await getOptionalUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single<Profile>();

  if (!profile) redirect("/dashboard");
  if (!isMemberRole(profile.role)) {
    redirect("/dashboard");
  }

  // New members must complete the setup wizard before editing their profile
  if (!profile.setup_completed) {
    redirect("/profile/setup");
  }

  const header = (
    <PageHeader title="My profile" subtitle="Your contact details and your household." />
  );

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
      // Household people without accounts (children etc.)
      supabase
        .from("family_members")
        .select("*")
        .eq("family_id", profile.family_id)
        .is("claimed_profile_id", null)
        .order("relationship")
        .returns<FamilyMember[]>(),
    ]);
    // Never render an empty household over a query error.
    const queryError = familyRes.error ?? othersRes.error ?? fmsRes.error;
    if (queryError) {
      console.error("Failed to load household data:", queryError);
      return (
        <PageContainer>
          {header}
          <ErrorState thing="your household" />
        </PageContainer>
      );
    }
    family = familyRes.data ?? null;
    householdProfiles = othersRes.data ?? [];
    familyMembers = fmsRes.data ?? [];
  }

  // Private buckets: exchange every stored avatar/photo URL for a
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
      {header}

      <ProfileHouseholdTabs
        profile={profile}
        family={family}
        householdProfiles={householdProfiles}
        familyMembers={familyMembers}
      />
    </PageContainer>
  );
}
