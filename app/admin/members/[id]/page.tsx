import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { ProfileForm } from "@/components/profile/ProfileForm";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { displayName } from "@/lib/names";
import type { FamilyUnit } from "@/lib/types";
import { PROFILE_COLUMNS, type MemberEmail, type ProfileColumns } from "@/lib/profileColumns";
import { getOptionalUser } from "@/lib/supabase/current-user";
import { pageTitle } from "@/lib/pageTitle";
import { toUserRole } from "@/lib/roles";
import { roleLockReason } from "../memberRoles";
import { MemberRole } from "./MemberRole";
import { logError } from "@/lib/log";

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

  const [{ data: row }, { data: address, error: addressError }, { data: families }, admins] = await Promise.all([
    supabase.from("profiles").select(PROFILE_COLUMNS).eq("id", id).single<ProfileColumns>(),
    supabase.rpc("admin_member_emails").eq("profile_id", id).maybeSingle<MemberEmail>(),
    supabase
      .from("family_units")
      .select("*")
      .order("family_name")
      .returns<FamilyUnit[]>(),
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin"),
  ]);

  if (!row) notFound();
  // The form saves whatever is in its Email field, so it must not open blank
  // over an address that failed to load.
  if (addressError) throw new Error(`Failed to load the member's email (${addressError.code})`);
  const profile = { ...row, email: address?.email ?? null };
  // An unknown count reads as one, the stricter of the two reasons the viewer's own role is locked.
  // A HEAD response has no body, so a failed count may carry no error and never a code.
  if (admins.error || admins.count === null) {
    logError("Failed to count church admins", admins.error, {
      route: "/admin/members/[id]",
      ids: { status: admins.status },
    });
  }
  const adminCount = admins.count ?? 1;

  return (
    <PageContainer size="reading">
      <PageHeader
        title="Edit member"
        subtitle={displayName(profile)}
        backHref="/admin/members"
        backLabel="Back to Members"
      />

      <MemberRole
        member={{ id: profile.id, name: displayName(profile), role: toUserRole(profile.role) }}
        lockReason={roleLockReason(profile.id, user.id, adminCount)}
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
