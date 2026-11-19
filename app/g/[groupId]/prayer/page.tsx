import { createClient } from "@/lib/supabase/server";
import { mintSignedUrl, mintSignedUrls } from "@/lib/storageRead";
import { redirect } from "next/navigation";
import { displayName, initials } from "@/lib/names";
import { PrayerBoard } from "@/components/prayer/PrayerBoard";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { ErrorState } from "@/components/states/ErrorState";
import { logError } from "@/lib/log";
import { loadPrayerKeys } from "@/lib/prayer/keys";
import { openWallRows, type SealedWallRow } from "@/lib/prayer/wall";
import { readList } from "@/lib/supabase/readList";
import { getOrgTimeZone } from "@/lib/time/orgZone";
import { requireActiveGroup } from "@/lib/groups/server";
import { getOptionalUser } from "@/lib/supabase/current-user";
import { groupPageTitle } from "@/lib/pageTitle";

export const generateMetadata = groupPageTitle("Prayer");

/** Null when the keys are missing or any text fails to open: the page shows its failed state, never ciphertext or a partial wall. */
function openRequests(raws: SealedWallRow[], viewerId: string) {
  const keys = loadPrayerKeys();
  if (!keys) {
    logError("Prayer keys are not configured", undefined, { route: "/g/[groupId]/prayer" });
    return null;
  }
  try {
    return openWallRows(raws, { viewerId, keys });
  } catch (err) {
    logError("Prayer requests could not be opened", err, { route: "/g/[groupId]/prayer" });
    return null;
  }
}

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
    .select("role, first_name, last_name, preferred_name, avatar_url")
    .eq("id", user.id)
    .single();
  if (!profile || profile.role === "pending") redirect("/dashboard");

  const [requests, timeZone] = await Promise.all([
    supabase
      .from("prayer_wall")
      .select("*")
      .eq("group_id", group.id)
      .order("created_at", { ascending: false })
      .then((read) => readList(read, "prayer requests")),
    getOrgTimeZone(),
  ]);

  const header = (
    <PageHeader title="Prayer" subtitle="Post a request with your name or anonymously." />
  );

  const wallRows = requests && openRequests(requests, user.id);
  if (wallRows === null) {
    return (
      <PageContainer size="wide">
        {header}
        <ErrorState thing="prayer requests" />
      </PageContainer>
    );
  }

  // Private buckets: exchange stored avatar URLs for signed URLs
  // before the wall rows and the composer's "me" reach client renders.
  const [signedWallAvatars, myAvatarUrl] = await Promise.all([
    mintSignedUrls(wallRows.map((r) => r.avatar_url)),
    mintSignedUrl(profile.avatar_url),
  ]);
  const signedRequests = wallRows.map((r, i) => ({
    ...r,
    avatar_url: signedWallAvatars[i],
  }));

  return (
    <PageContainer size="wide">
      {header}
      <PrayerBoard
        initialRequests={signedRequests}
        me={{
          id: user.id,
          name: displayName(profile),
          initials: initials(profile),
          avatarUrl: myAvatarUrl,
        }}
        group={{ id: group.id, name: group.name }}
        timeZone={timeZone}
      />
    </PageContainer>
  );
}
