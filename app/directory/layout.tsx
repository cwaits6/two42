import { redirect } from "next/navigation";
import { DirectoryShell } from "@/components/directory/DirectoryShell";
import { getRequestBranding } from "@/lib/branding";
import { getDirectoryVisibility } from "@/lib/directory/visibility";
import { getViewerFamilyId } from "@/lib/directory/viewerFamily";
import { todayIn } from "@/lib/serving/dates";
import { getOptionalUser } from "@/lib/supabase/current-user";
import { getOrgTimeZone } from "@/lib/time/orgZone";

// The org-level entry to the one directory: opens at "All my groups".
export default async function DirectoryLayout({ children }: { children: React.ReactNode }) {
  const user = await getOptionalUser();
  if (!user) redirect("/login");

  const [branding, visibility, timeZone, viewerFamilyId] = await Promise.all([
    getRequestBranding(),
    getDirectoryVisibility(),
    getOrgTimeZone(),
    getViewerFamilyId(user.id),
  ]);

  return (
    <DirectoryShell
      orgName={branding.display_name}
      activeGroupId={null}
      orgVisible={visibility === "org"}
      basePath="/directory"
      currentUserId={user.id}
      currentFamilyId={viewerFamilyId}
      today={todayIn(timeZone)}
    >
      {children}
    </DirectoryShell>
  );
}
