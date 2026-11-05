import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { INFO_LINKS } from "@/components/layout/infoLinks";
import { redirect } from "next/navigation";
import { DisplayCard } from "./DisplayCard";
import { SignInSecurityCard } from "./SignInSecurityCard";
import { NotificationsCard } from "./NotificationsCard";
import { FeedbackCard } from "./FeedbackCard";
import { YourDataCard } from "./YourDataCard";
import { getOptionalUser } from "@/lib/supabase/current-user";
import { NO_ROW } from "@/lib/landing";
import { getPlatformAdmin } from "@/lib/platform-access";
import { isMemberRole } from "@/lib/roles";
import { pageTitle } from "@/lib/pageTitle";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";

export const generateMetadata = () => pageTitle("Settings");

export default async function SettingsPage() {
  const supabase = await createClient();

  const user = await getOptionalUser();
  if (!user) redirect("/login");

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("role, email_announcements, email_event_reminders")
    .eq("id", user.id)
    .single();

  const member = profile && isMemberRole(profile.role) ? profile : null;
  if (!member) {
    // An operator who belongs to no church has no profile, and still needs
    // the sign-in card. A failed read is not a missing row; Home reports it.
    const isOperator = error?.code === NO_ROW && (await getPlatformAdmin()) !== null;
    if (!isOperator) redirect("/dashboard");
  }

  return (
    <PageContainer>
      {member ? (
        <PageHeader title="Settings" />
      ) : (
        <PageHeader title="Settings" backHref="/platform" backLabel="Back to Platform" />
      )}

      <div className="space-y-6">
        <DisplayCard />
        <SignInSecurityCard currentEmail={user.email ?? ""} />
        {member && (
          <>
            <NotificationsCard
              userId={user.id}
              initial={{
                email_announcements: member.email_announcements ?? true,
                email_event_reminders: member.email_event_reminders ?? true,
              }}
            />
            <FeedbackCard />
            <YourDataCard />
          </>
        )}
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
    </PageContainer>
  );
}
