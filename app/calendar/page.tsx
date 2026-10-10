import { redirect } from "next/navigation";
import { CalendarPage } from "@/components/events/CalendarPage";
import { getGroupMemberships } from "@/lib/groups/server";
import { siteConfig } from "@/lib/config";

export const metadata = { title: `Calendar | ${siteConfig.name}` };

// The org-level calendar. A one-group member is always inside their group,
// so the page is that group's calendar; a member of none goes Home, where
// the no-group card lives.
export default async function OrgCalendarPage() {
  const memberships = await getGroupMemberships();
  if (memberships.length === 0) redirect("/dashboard");
  return <CalendarPage pinnedGroupId={memberships.length === 1 ? memberships[0].id : undefined} />;
}
