import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DirectoryVisibilitySettings } from "@/components/directory/DirectoryVisibilitySettings";
import { GivingSettings } from "@/components/giving/GivingSettings";
import { getDirectoryVisibility } from "@/lib/directory/visibility";
import { givingStewardsCanManage } from "@/lib/giving/server";
import { getOptionalUser } from "@/lib/supabase/current-user";
import { TimezoneSettings } from "@/components/admin/TimezoneSettings";
import { getOrgTimeZone } from "@/lib/time/orgZone";
import { CUSTOM_SENDING_DOMAINS_ENABLED } from "@/lib/email/sendingDomains";
import { pageTitle } from "@/lib/pageTitle";

export const generateMetadata = () => pageTitle("Church settings");

export default async function SettingsPage() {
  const supabase = await createClient();
  const user = await getOptionalUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, org_id")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") redirect("/dashboard");

  const [stewardsCanManage, directoryVisibility] = await Promise.all([
    givingStewardsCanManage(supabase, profile.org_id),
    getDirectoryVisibility(),
  ]);

  return (
    <div className="container mx-auto px-4 py-12 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-3xl text-brand-primary-text">Org settings</CardTitle>
        </CardHeader>
        <CardContent>
          {CUSTOM_SENDING_DOMAINS_ENABLED && (
            <div className="mb-8 flex flex-col gap-3 sm:flex-row">
              <Button
                size="lg"
                variant="outline"
                className="text-lg"
                nativeButton={false}
                render={<Link href="/admin/settings/email" />}
              >
                Email sending domain
              </Button>
            </div>
          )}
          <h2 className="mb-3 text-xl font-bold text-foreground">Directory</h2>
          {directoryVisibility ? (
            <DirectoryVisibilitySettings orgId={profile.org_id} visibility={directoryVisibility} />
          ) : (
            <p className="text-base text-muted-foreground">
              The directory setting could not be loaded. Reload the page to try again.
            </p>
          )}
          <h2 className="mb-3 mt-8 text-xl font-bold text-foreground">Giving</h2>
          <GivingSettings stewardsCanManage={stewardsCanManage} />
          <h2 className="mb-3 mt-8 text-xl font-bold text-foreground">Time zone</h2>
          <TimezoneSettings orgId={profile.org_id} timezone={await getOrgTimeZone()} />
        </CardContent>
      </Card>
    </div>
  );
}
