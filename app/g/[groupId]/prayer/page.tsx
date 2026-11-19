import { createClient, createServiceClient } from "@/lib/supabase/server";
import { mintSignedUrl, mintSignedUrls } from "@/lib/storageRead";
import { redirect } from "next/navigation";
import { displayName, initials } from "@/lib/names";
import { PrayerBoard } from "@/components/prayer/PrayerBoard";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { ErrorState } from "@/components/states/ErrorState";
import { logError } from "@/lib/log";
import type { PrayerKeys } from "@/lib/prayer/crypto";
import type { PrayerCommentView } from "@/lib/prayer/comments";
import { commentWriterNames, openComments, readCommentRows } from "@/lib/prayer/commentThread";
import { loadPrayerKeys } from "@/lib/prayer/keys";
import { openWallRows, type SealedWallRow } from "@/lib/prayer/wall";
import type { PrayerWallRow } from "@/lib/types";
import { readList } from "@/lib/supabase/readList";
import { getOrgTimeZone } from "@/lib/time/orgZone";
import { requireActiveGroup } from "@/lib/groups/server";
import { getOptionalUser } from "@/lib/supabase/current-user";
import { groupPageTitle } from "@/lib/pageTitle";

export const generateMetadata = groupPageTitle("Prayer");

/** Null when any text fails to open: the page shows its failed state, never ciphertext or a partial wall. */
function openRequests(raws: SealedWallRow[], viewerId: string, keys: PrayerKeys) {
  try {
    return openWallRows(raws, { viewerId, keys });
  } catch (err) {
    logError("Prayer requests could not be opened", err, { route: "/g/[groupId]/prayer" });
    return null;
  }
}

type Threads = Record<string, PrayerCommentView[]>;

/**
 * The comments the viewer may read, by request. "unavailable" when a read
 * fails: the wall still renders, with no comments and no way to add one.
 * "failed" when a comment's text cannot be opened, which fails the page as
 * request text does.
 */
async function loadThreads(opts: {
  orgId: string;
  groupId: string;
  viewerId: string;
  isLeader: boolean;
  keys: PrayerKeys;
  wall: PrayerWallRow[];
}): Promise<Threads | "unavailable" | "failed"> {
  const service = await createServiceClient();
  const read = await readCommentRows(service, opts.orgId, opts.groupId);
  if (read.error || !read.data) {
    logError("Failed to read prayer comments", read.error, { route: "/g/[groupId]/prayer" });
    return "unavailable";
  }
  let opened;
  try {
    opened = openComments(read.data, { ...opts, requests: new Map(opts.wall.map((r) => [r.id, r])) });
  } catch (err) {
    logError("Prayer comments could not be opened", err, { route: "/g/[groupId]/prayer" });
    return "failed";
  }
  const names = await commentWriterNames(
    await createClient(),
    opts.orgId,
    opened.flatMap((c) => (c.writerId ? [c.writerId] : [])),
  );
  if (names.error || !names.data) {
    logError("Failed to read prayer comment writers", names.error, { route: "/g/[groupId]/prayer" });
    return "unavailable";
  }
  const byId = new Map(names.data.map((n) => [n.id, n]));
  const threads: Threads = {};
  for (const { view, writerId } of opened) {
    const name = writerId ? byId.get(writerId) : undefined;
    (threads[view.request_id] ??= []).push({
      ...view,
      first_name: name?.first_name ?? null,
      last_name: name?.last_name ?? null,
      preferred_name: name?.preferred_name ?? null,
    });
  }
  return threads;
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
    .select("org_id, role, first_name, last_name, preferred_name, avatar_url")
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

  const keys = loadPrayerKeys();
  if (!keys) logError("Prayer keys are not configured", undefined, { route: "/g/[groupId]/prayer" });
  const wallRows = requests && keys && openRequests(requests, user.id, keys);
  const threads =
    wallRows &&
    keys &&
    (await loadThreads({
      orgId: profile.org_id,
      groupId: group.id,
      viewerId: user.id,
      isLeader: group.role === "leader",
      keys,
      wall: wallRows,
    }));
  if (!wallRows || threads === "failed") {
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
        initialComments={threads === "unavailable" ? null : threads}
      />
    </PageContainer>
  );
}
