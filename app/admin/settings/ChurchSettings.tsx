import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { DirectoryVisibilitySettings } from "@/components/admin/DirectoryVisibilitySettings";
import { GivingSettings } from "@/components/giving/GivingSettings";
import { ErrorState } from "@/components/states/ErrorState";
import { getDirectoryVisibility } from "@/lib/directory/visibility";
import { givingStewardsCanManage } from "@/lib/giving/server";
import { getOptionalUser } from "@/lib/supabase/current-user";
import { TimezoneSettings } from "@/components/admin/TimezoneSettings";
import { getOrgTimeZone } from "@/lib/time/orgZone";
import { CUSTOM_SENDING_DOMAINS_ENABLED } from "@/lib/email/sendingDomains";

export async function ChurchSettings() {
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
    <>
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
        <ErrorState thing="the directory setting" />
      )}
      <h2 className="mb-3 mt-8 text-xl font-bold text-foreground">Giving</h2>
      <GivingSettings stewardsCanManage={stewardsCanManage} />
      <h2 className="mb-3 mt-8 text-xl font-bold text-foreground">Events</h2>
      <TimezoneSettings orgId={profile.org_id} timezone={await getOrgTimeZone()} />
    </>
  );
}
