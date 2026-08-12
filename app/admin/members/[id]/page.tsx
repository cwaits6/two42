import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ProfileForm } from "@/components/profile/ProfileForm";
import { MemberGroupsSection } from "@/components/profile/MemberGroupsSection";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { siteConfig } from "@/lib/config";
import { displayName } from "@/lib/names";
import { canManageAvatar } from "@/lib/members/avatar-eligibility";
import type { Profile, FamilyUnit } from "@/lib/types";

export const metadata = { title: `Edit Member | ${siteConfig.name}` };

interface EditMemberPageProps {
  params: Promise<{ id: string }>;
}

export default async function EditMemberPage({ params }: EditMemberPageProps) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
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
    <div className="container mx-auto px-4 py-12 max-w-3xl">
      <Button
        variant="ghost"
        size="sm"
        nativeButton={false}
        render={<Link href="/admin/members" />}
        className="mb-4"
      >
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back to members
      </Button>
      <h1 className="text-3xl md:text-4xl font-bold text-brand-primary mb-2">
        Edit Member
      </h1>
      <p className="text-base text-muted-foreground mb-8">
        Editing <span className="font-semibold">{displayName(profile)}</span>.
        Admin can update any field and change family assignment.
      </p>

      <ProfileForm
        profile={profile}
        families={families || []}
        isAdmin={true}
        canManageAvatar={canManageAvatar(
          {
            id: user.id,
            family_id: currentProfile.family_id,
            relationship: currentProfile.relationship,
          },
          { id: profile.id, family_id: profile.family_id }
        )}
      />

      <MemberGroupsSection profileId={profile.id} />
    </div>
  );
}
