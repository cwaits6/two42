import { redirect } from "next/navigation";
import { CalendarPage } from "@/components/events/CalendarPage";
import { getGroupMemberships } from "@/lib/groups/server";
import { siteConfig } from "@/lib/config";

export const metadata = { title: `Calendar | ${siteConfig.name}` };

// The org-level calendar: every group the member belongs to, each in its
// own color. A member of none goes Home, where the no-group card lives.
export default async function OrgCalendarPage() {
  const memberships = await getGroupMemberships();
  if (memberships.length === 0) redirect("/dashboard");
  return <CalendarPage />;
}
