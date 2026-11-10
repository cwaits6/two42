import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { ProfileForm } from "@/components/profile/ProfileForm";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { ErrorState } from "@/components/states/ErrorState";
import { isUuid } from "@/lib/groups/active";
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
  if (!isUuid(id)) notFound();

  const [person, address, families, admins] = await Promise.all([
    supabase.from("profiles").select(PROFILE_COLUMNS).eq("id", id).maybeSingle<ProfileColumns>(),
    supabase.rpc("admin_member_emails").eq("profile_id", id).maybeSingle<MemberEmail>(),
    supabase
      .from("family_units")
      .select("*")
      .order("family_name")
      .returns<FamilyUnit[]>(),
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin"),
  ]);

  // The form saves its Email field and household picker as they open, so it
  // must not open blank over a read that failed.
  if (person.error) logError("Failed to load the member", person.error, { route: "/admin/members/[id]" });
  if (address.error) logError("Failed to load the member's email", address.error, { route: "/admin/members/[id]" });
  if (families.error) logError("Failed to load households", families.error, { route: "/admin/members/[id]" });
  if (person.error || address.error || families.error) {
    return (
      <PageContainer size="reading">
        <PageHeader title="Edit member" backHref="/admin/members" backLabel="Back to Members" />
        <ErrorState thing="this member" />
      </PageContainer>
    );
  }
  // RLS returns no row for a member of another church.
  if (!person.data) notFound();
  const profile = { ...person.data, email: address.data?.email ?? null };
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
        families={families.data ?? []}
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
