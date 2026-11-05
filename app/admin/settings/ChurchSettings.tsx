import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { DirectoryVisibilitySettings } from "@/components/admin/DirectoryVisibilitySettings";
import { GivingSettings } from "@/components/giving/GivingSettings";
import { ErrorState } from "@/components/states/ErrorState";
import { getDirectoryVisibility } from "@/lib/directory/visibility";
import { readStewardsCanManage } from "@/lib/giving/server";
import { getOptionalUser } from "@/lib/supabase/current-user";
import { PrayerRetentionSettings } from "@/components/admin/PrayerRetentionSettings";
import { TimezoneSettings } from "@/components/admin/TimezoneSettings";
import { getPrayerRetention } from "@/lib/orgPrayerRetention";
import { isValidTimeZone } from "@/lib/time/zone";
import { CUSTOM_SENDING_DOMAINS_ENABLED } from "@/lib/email/sendingDomains";
import { OrgGroupControls } from "@/components/admin/OrgGroupControls";
import { GroupDiscoverySettings } from "@/components/groups/GroupDiscoverySettings";
import { parseGroupCreationPolicy } from "@/lib/groups/creation";

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

  // The church's row is read here, not through the member-facing helpers: those
  // resolve a failed read to the fail-closed value, which a control would show
  // as the setting.
  const [rulesRead, stewardsCanManage, directoryVisibility, prayerRetention] = await Promise.all([
    supabase
      .from("organizations")
      .select("group_discovery, group_creation_policy, timezone")
      .eq("id", profile.org_id)
      .maybeSingle(),
    readStewardsCanManage(supabase, profile.org_id),
    getDirectoryVisibility(),
    getPrayerRetention(),
  ]);
  if (rulesRead.error) console.error("Failed to load the church's rules: code=%s", rulesRead.error.code);
  const rules = rulesRead.error ? null : rulesRead.data;
  const timeZone = rules && isValidTimeZone(rules.timezone) ? rules.timezone : null;

  return (
    <>
      <h2 className="mb-3 text-xl font-bold text-foreground">Directory</h2>
      {directoryVisibility ? (
        <DirectoryVisibilitySettings orgId={profile.org_id} visibility={directoryVisibility} />
      ) : (
        <ErrorState thing="the directory setting" />
      )}
      <h2 className="mb-3 mt-8 text-xl font-bold text-foreground">Groups</h2>
      {rules ? (
        <div className="space-y-4">
          <GroupDiscoverySettings orgId={profile.org_id} discoveryOn={rules.group_discovery === true} />
          <OrgGroupControls
            orgId={profile.org_id}
            policy={parseGroupCreationPolicy(rules.group_creation_policy)}
          />
        </div>
      ) : (
        <ErrorState thing="the group settings" />
      )}
      <h2 className="mb-3 mt-8 text-xl font-bold text-foreground">Giving</h2>
      {stewardsCanManage === null ? (
        <ErrorState thing="the giving setting" />
      ) : (
        <GivingSettings stewardsCanManage={stewardsCanManage} />
      )}
      <h2 className="mb-3 mt-8 text-xl font-bold text-foreground">Events</h2>
      {timeZone ? (
        <TimezoneSettings orgId={profile.org_id} timezone={timeZone} />
      ) : (
        <ErrorState thing="the time zone" />
      )}
      <h2 className="mb-3 mt-8 text-xl font-bold text-foreground">Prayer requests</h2>
      {prayerRetention ? (
        <PrayerRetentionSettings orgId={profile.org_id} retention={prayerRetention} />
      ) : (
        <ErrorState thing="the prayer request setting" />
      )}
      {CUSTOM_SENDING_DOMAINS_ENABLED && (
        <>
          <h2 className="mb-3 mt-8 text-xl font-bold text-foreground">Email</h2>
          <Button
            size="lg"
            variant="outline"
            className="w-full text-lg sm:w-auto"
            nativeButton={false}
            render={<Link href="/admin/settings/email" />}
          >
            Email sending domain
          </Button>
        </>
      )}
    </>
  );
}
