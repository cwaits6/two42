import { createClient } from "@/lib/supabase/server";
import { mintSignedUrl, mintSignedUrls } from "@/lib/storageRead";
import { redirect } from "next/navigation";
import { displayName, initials } from "@/lib/names";
import { loadFundFormData } from "@/lib/giving/server";
import { getGroupSettings } from "@/lib/groups/settings";
import { PrayerBoard } from "@/components/prayer/PrayerBoard";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { ErrorState } from "@/components/states/ErrorState";
import { toCallSession, toWallRow } from "@/lib/prayer";
import { readList } from "@/lib/supabase/readList";
import { getOrgTimeZone } from "@/lib/time/orgZone";
import { requireActiveGroup } from "@/lib/groups/server";
import { getOptionalUser } from "@/lib/supabase/current-user";
import { groupPageTitle } from "@/lib/pageTitle";

export const generateMetadata = groupPageTitle("Prayer");

export default async function PrayerPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const group = await requireActiveGroup(groupId);
  const supabase = await createClient();
  const user = await getOptionalUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, org_id, first_name, last_name, preferred_name, avatar_url")
    .eq("id", user.id)
    .single();
  if (!profile || profile.role === "pending") redirect("/dashboard");

  const [requests, sessions, { members }, settings, timeZone] = await Promise.all([
    supabase
      .from("prayer_wall")
      .select("*")
      .eq("group_id", group.id)
      .order("created_at", { ascending: false })
      .then((read) => readList(read, "prayer requests")),
    supabase
      .from("prayer_call_sessions")
      .select("*")
      .eq("group_id", group.id)
      .order("display_order")
      .order("created_at")
      .then((read) => readList(read, "prayer call times")),
    loadFundFormData(supabase, profile.org_id),
    // getGroupSettings logs its own failure; the call card reports it.
    getGroupSettings(supabase, profile.org_id, group.id).catch(() => null),
    getOrgTimeZone(),
  ]);

  const header = (
    <PageHeader title="Prayer" subtitle="Post a request with your name or anonymously." />
  );

  if (requests === null) {
    return (
      <PageContainer size="wide">
        {header}
        <ErrorState thing="prayer requests" />
      </PageContainer>
    );
  }

  // Private buckets: exchange stored avatar URLs for signed URLs
  // before the wall rows and the composer's "me" reach client renders.
  const wallRows = requests.map(toWallRow);
  const [signedWallAvatars, myAvatarUrl] = await Promise.all([
    mintSignedUrls(wallRows.map((r) => r.avatar_url)),
    mintSignedUrl(profile.avatar_url),
  ]);
  const signedRequests = wallRows.map((r, i) => ({
    ...r,
    avatar_url: signedWallAvatars[i],
  }));

  // The call card is all or nothing: a leader editing it with half its data
  // missing would save the gap over what is stored.
  const prayerCall =
    sessions === null || settings === null
      ? null
      : {
          sessions: sessions.map(toCallSession),
          url: settings.weekly_prayer_call_url?.startsWith("https://")
            ? settings.weekly_prayer_call_url
            : null,
          time: settings.weekly_prayer_call_time,
        };

  return (
    <PageContainer size="wide">
      {header}
      <PrayerBoard
        initialRequests={signedRequests}
        prayerCall={prayerCall}
        me={{
          id: user.id,
          name: displayName(profile),
          initials: initials(profile),
          avatarUrl: myAvatarUrl,
        }}
        group={{ id: group.id, name: group.name, isLeader: group.role === "leader" }}
        members={members}
        orgId={profile.org_id}
        timeZone={timeZone}
      />
    </PageContainer>
  );
}
