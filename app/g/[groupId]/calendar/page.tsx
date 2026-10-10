import { CalendarPage } from "@/components/events/CalendarPage";
import { requireActiveGroup } from "@/lib/groups/server";
import { siteConfig } from "@/lib/config";

export const metadata = { title: `Calendar | ${siteConfig.name}` };

export default async function GroupCalendarPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const group = await requireActiveGroup(groupId);
  return <CalendarPage pinnedGroupId={group.id} />;
}
