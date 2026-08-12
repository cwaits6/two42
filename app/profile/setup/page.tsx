import { createClient } from "@/lib/supabase/server";
import { mintSignedUrl } from "@/lib/storageRead";
import { redirect } from "next/navigation";
import { siteConfig } from "@/lib/config";
import type { Profile } from "@/lib/types";
import { SetupWizard } from "./SetupWizard";

export const metadata = { title: `Profile Setup | ${siteConfig.name}` };

export default async function ProfileSetupPage() {
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

  // Only approved members should be doing setup
  if (!["member", "content_editor", "admin"].includes(profile.role)) {
    redirect("/dashboard");
  }

  // If already completed, send to directory
  if (profile.setup_completed) {
    redirect("/directory");
  }

  // Private buckets (CWA-59): the wizard's avatar preview renders this
  // value; the wizard itself persists only fresh raw upload URLs.
  profile.avatar_url = await mintSignedUrl(profile.avatar_url);

  return (
    <div className="min-h-dvh bg-background">
      <div className="container mx-auto px-4 py-12 max-w-2xl">
        <div className="text-center mb-10">
          <h1 className="text-3xl md:text-4xl font-bold text-brand-primary mb-3">
            Welcome to {siteConfig.name}!
          </h1>
          <p className="text-lg text-muted-foreground">
            Let&apos;s set up your profile so others in the group can connect with you.
            This only takes a few minutes.
          </p>
        </div>

        <SetupWizard profile={profile} userEmail={user.email ?? ""} />
      </div>
    </div>
  );
}
