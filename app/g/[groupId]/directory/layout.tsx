import { redirect } from "next/navigation";
import { DirectoryShell } from "@/components/directory/DirectoryShell";
import { getRequestBranding } from "@/lib/branding";
import { liveDirectoryOn } from "@/lib/integrations/records/live";
import { getDirectoryVisibility } from "@/lib/directory/visibility";
import { getViewerFamilyId } from "@/lib/directory/viewerFamily";
import { groupPath } from "@/lib/groups/active";
import { requireActiveGroup } from "@/lib/groups/server";
import { todayIn } from "@/lib/serving/dates";
import { getOptionalUser } from "@/lib/supabase/current-user";
import { getOrgTimeZone } from "@/lib/time/orgZone";

// The group-level entry to the one directory: opens at "This group".
export default async function GroupDirectoryLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const user = await getOptionalUser();
  if (!user) redirect("/login");
  const group = await requireActiveGroup(groupId);
  const [branding, visibility, timeZone, viewerFamilyId, recordsLive] = await Promise.all([
    getRequestBranding(),
    getDirectoryVisibility(),
    getOrgTimeZone(),
    getViewerFamilyId(user.id),
    liveDirectoryOn(),
  ]);

  return (
    <DirectoryShell
      orgName={branding.display_name}
      activeGroupId={group.id}
      orgVisible={visibility === "org"}
      basePath={groupPath(group.id, "/directory")}
      currentUserId={user.id}
      currentFamilyId={viewerFamilyId}
      today={todayIn(timeZone)}
      recordsLive={recordsLive}
    >
      {children}
    </DirectoryShell>
  );
}
