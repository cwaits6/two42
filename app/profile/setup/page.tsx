import { createClient } from "@/lib/supabase/server";
import { mintSignedUrl } from "@/lib/storageRead";
import { redirect } from "next/navigation";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import type { Profile } from "@/lib/types";
import { SetupWizard } from "./SetupWizard";
import { getOptionalUser } from "@/lib/supabase/current-user";
import { isMemberRole } from "@/lib/roles";
import { pageTitle } from "@/lib/pageTitle";

export const generateMetadata = () => pageTitle("Set up your profile");

export default async function ProfileSetupPage() {
  const supabase = await createClient();

  const user = await getOptionalUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single<Profile>();

  if (!profile) redirect("/dashboard");

  // Only approved members should be doing setup
  if (!isMemberRole(profile.role)) {
    redirect("/dashboard");
  }

  // If already completed, send to directory
  if (profile.setup_completed) {
    redirect("/directory");
  }

  // Private buckets: the wizard's avatar preview renders this
  // value; the wizard itself persists only fresh raw upload URLs.
  const [avatarUrl, household] = await Promise.all([
    mintSignedUrl(profile.avatar_url),
    profile.family_id
      ? supabase
          .from("family_units")
          .select("family_name")
          .eq("id", profile.family_id)
          .maybeSingle()
      : null,
  ]);
  profile.avatar_url = avatarUrl;

  return (
    <PageContainer size="reading">
      <PageHeader
        title="Set up your profile"
        subtitle="Add how to reach you and who you live with, so people in your groups can find you."
      />
      <SetupWizard
        profile={profile}
        userEmail={user.email ?? ""}
        householdName={household?.data?.family_name ?? null}
      />
    </PageContainer>
  );
}
