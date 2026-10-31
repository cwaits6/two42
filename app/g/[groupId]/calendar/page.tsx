import { CalendarPage } from "@/components/events/CalendarPage";
import { requireActiveGroup } from "@/lib/groups/server";
import { groupPageTitle } from "@/lib/pageTitle";

export const generateMetadata = groupPageTitle("Calendar");

export default async function GroupCalendarPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const group = await requireActiveGroup(groupId);
  return <CalendarPage pinnedGroupId={group.id} />;
}
