import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { INFO_LINKS } from "@/components/layout/infoLinks";
import { redirect } from "next/navigation";
import { DisplayCard } from "./DisplayCard";
import { SignInSecurityCard } from "./SignInSecurityCard";
import { NotificationsCard } from "./NotificationsCard";
import { FeedbackCard } from "./FeedbackCard";
import { getOptionalUser } from "@/lib/supabase/current-user";
import { isMemberRole } from "@/lib/roles";
import { pageTitle } from "@/lib/pageTitle";

export const generateMetadata = () => pageTitle("Settings");

export default async function SettingsPage() {
  const supabase = await createClient();

  const user = await getOptionalUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, email_announcements")
    .eq("id", user.id)
    .single();

  if (!profile || !isMemberRole(profile.role)) {
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

      <nav aria-label="Privacy, terms and help" className="mt-8 flex flex-wrap gap-x-6">
        {INFO_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="inline-flex min-h-11 items-center text-base font-semibold text-brand-primary-text underline underline-offset-4 hover:text-foreground"
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
