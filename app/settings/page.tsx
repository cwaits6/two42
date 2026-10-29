import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { siteConfig } from "@/lib/config";
import { DisplayCard } from "./DisplayCard";
import { SignInSecurityCard } from "./SignInSecurityCard";
import { NotificationsCard } from "./NotificationsCard";
import { FeedbackCard } from "./FeedbackCard";
import { getOptionalUser } from "@/lib/supabase/current-user";

export const metadata = { title: `Settings | ${siteConfig.name}` };

export default async function SettingsPage() {
  const supabase = await createClient();

  const user = await getOptionalUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, email_announcements")
    .eq("id", user.id)
    .single();

  if (!profile || !["member", "content_editor", "admin"].includes(profile.role)) {
    redirect("/dashboard");
  }

  return (
    <div className="container mx-auto max-w-3xl px-4 py-12">
      <h1 className="mb-2 text-3xl font-bold text-brand-primary-text md:text-4xl">
        Settings
      </h1>
      <p className="mb-8 text-muted-foreground">
        Make the app comfortable for you. Your choices are saved automatically.
      </p>

      <div className="space-y-6">
        <DisplayCard />
        <SignInSecurityCard currentEmail={user.email ?? ""} />
        <NotificationsCard
          userId={user.id}
          initialEmailAnnouncements={profile.email_announcements ?? true}
        />
        <FeedbackCard />
      </div>
    </div>
  );
}
