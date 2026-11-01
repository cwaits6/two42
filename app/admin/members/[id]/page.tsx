import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { ProfileForm } from "@/components/profile/ProfileForm";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { displayName } from "@/lib/names";
import type { Profile, FamilyUnit } from "@/lib/types";
import { getOptionalUser } from "@/lib/supabase/current-user";
import { pageTitle } from "@/lib/pageTitle";

export const generateMetadata = () => pageTitle("Edit member");

interface EditMemberPageProps {
  params: Promise<{ id: string }>;
}

export default async function EditMemberPage({ params }: EditMemberPageProps) {
  const { id } = await params;
  const supabase = await createClient();

  const user = await getOptionalUser();
  if (!user) redirect("/login");

  const { data: currentProfile } = await supabase
    .from("profiles")
    .select("role, family_id, relationship")
    .eq("id", user.id)
    .single();

  if (currentProfile?.role !== "admin") redirect("/dashboard");

  const [{ data: profile }, { data: families }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", id).single<Profile>(),
    supabase
      .from("family_units")
      .select("*")
      .order("family_name")
      .returns<FamilyUnit[]>(),
  ]);

  if (!profile) notFound();

  return (
    <PageContainer size="reading">
      <PageHeader
        title="Edit member"
        subtitle={displayName(profile)}
        backHref="/admin/members"
        backLabel="Back to Members"
      />

      <ProfileForm
        profile={profile}
        families={families || []}
        isAdmin={true}
        // Caller context (not a precomputed boolean) so the form can
        // re-derive avatar-write eligibility after it saves a family
        // reassignment — a boolean computed here from the initial
        // profile.family_id goes stale the moment the admin moves the
        // member in or out of their household.
        avatarCaller={{
          id: user.id,
          family_id: currentProfile.family_id,
          relationship: currentProfile.relationship,
        }}
      />
    </PageContainer>
  );
}
