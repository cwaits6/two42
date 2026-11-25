import { notFound } from "next/navigation";
import { requireActiveGroup } from "@/lib/groups/server";
import { getGroupSettings } from "@/lib/groups/settings";
import { resolveRequestOrgId } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";

// The group layout above already 404s anyone outside the group. A group
// whose leader has not turned the dinner club on has no such page, and
// turning it off hides the page without touching a season.
export default async function DinnerClubLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const group = await requireActiveGroup(groupId);
  const supabase = await createClient();
  const orgId = await resolveRequestOrgId(supabase, { label: "dinner club page" });
  if (!orgId) notFound();
  const settings = await getGroupSettings(supabase, orgId, group.id);
  if (!settings.dinner_club_enabled) notFound();
  return <>{children}</>;
}
