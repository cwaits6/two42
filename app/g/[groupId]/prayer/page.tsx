import { createClient } from "@/lib/supabase/server";
import { mintSignedUrl, mintSignedUrls } from "@/lib/storageRead";
import { redirect } from "next/navigation";
import { siteConfig } from "@/lib/config";
import { displayName, initials } from "@/lib/names";
import { loadFundFormData } from "@/lib/giving/server";
import { getGroupSettings } from "@/lib/groups/settings";
import { PrayerBoard } from "@/components/prayer/PrayerBoard";
import type { PrayerCallSession, PrayerWallRow } from "@/lib/types";
import { requireActiveGroup } from "@/lib/groups/server";

export const metadata = { title: `Prayer | ${siteConfig.name}` };

export default async function PrayerPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const group = await requireActiveGroup(groupId);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, org_id, first_name, last_name, preferred_name, avatar_url")
    .eq("id", user.id)
    .single();
  if (!profile || profile.role === "pending") redirect("/dashboard");

  const [
    { data: requests, error: requestsError },
    { data: sessions, error: sessionsError },
    { members },
    settings,
  ] = await Promise.all([
    supabase
      .from("prayer_wall")
      .select("*")
      .eq("group_id", group.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("prayer_call_sessions")
      .select("*")
      .eq("group_id", group.id)
      .order("display_order")
      .order("created_at"),
    loadFundFormData(supabase, profile.org_id),
    getGroupSettings(supabase, profile.org_id, group.id),
  ]);
  if (requestsError) {
    console.error("Failed to fetch prayer requests:", requestsError);
    throw new Error("Failed to load the prayer wall.");
  }
  if (sessionsError) {
    console.error("Failed to fetch prayer call sessions:", sessionsError);
  }

  // Private buckets: exchange stored avatar URLs for signed URLs
  // before the wall rows and the composer's "me" reach client renders.
  const wallRows = (requests ?? []) as PrayerWallRow[];
  const [signedWallAvatars, myAvatarUrl] = await Promise.all([
    mintSignedUrls(wallRows.map((r) => r.avatar_url)),
    mintSignedUrl(profile.avatar_url),
  ]);
  const signedRequests = wallRows.map((r, i) => ({
    ...r,
    avatar_url: signedWallAvatars[i],
  }));

  return (
    <div className="container mx-auto px-4 py-12 max-w-6xl">
      <h1 className="text-3xl md:text-4xl font-bold text-brand-primary mb-2">
        Prayer
      </h1>
      <p className="text-lg text-muted-foreground max-w-2xl">
        Post a request with your name or anonymously.
      </p>

      <div className="mt-10">
        <PrayerBoard
          initialRequests={signedRequests}
          sessions={(sessions ?? []) as PrayerCallSession[]}
          me={{
            id: user.id,
            name: displayName(profile),
            initials: initials(profile),
            avatarUrl: myAvatarUrl,
          }}
          group={{ id: group.id, name: group.name, isLeader: group.role === "leader" }}
          members={members}
          orgId={profile.org_id}
          prayerCall={{
            url: settings.weekly_prayer_call_url,
            time: settings.weekly_prayer_call_time,
          }}
        />
      </div>
    </div>
  );
}
