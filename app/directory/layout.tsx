import { redirect } from "next/navigation";
import { DirectoryShell } from "@/components/directory/DirectoryShell";
import { getRequestBranding } from "@/lib/branding";
import { getDirectoryVisibility } from "@/lib/directory/visibility";
import { getOptionalUser } from "@/lib/supabase/current-user";

// The org-level entry to the one directory: opens at "All my groups".
export default async function DirectoryLayout({ children }: { children: React.ReactNode }) {
  const user = await getOptionalUser();
  if (!user) redirect("/login");

  const [branding, visibility] = await Promise.all([getRequestBranding(), getDirectoryVisibility()]);

  return (
    <DirectoryShell
      orgName={branding.display_name}
      activeGroupId={null}
      orgVisible={visibility === "org"}
      basePath="/directory"
      currentUserId={user.id}
    >
      {children}
    </DirectoryShell>
  );
}
