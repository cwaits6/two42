import { Suspense } from "react";
import { redirect } from "next/navigation";
import { NewEventForm } from "@/components/events/NewEventForm";
import { createClient } from "@/lib/supabase/server";
import { getGroupCalendar } from "@/lib/groups/calendar";
import { requireGroupLeader } from "@/lib/groups/server";
import { siteConfig } from "@/lib/config";
import { getOptionalUser } from "@/lib/supabase/current-user";
import { getOrgTimeZone } from "@/lib/time/orgZone";

export const metadata = { title: `Create Event | ${siteConfig.name}` };

export default async function NewEventPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const group = await requireGroupLeader(groupId);
  const supabase = await createClient();
  const user = await getOptionalUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("org_id")
    .eq("id", user.id)
    .single();
  if (!profile) redirect("/dashboard");

  const [calendar, timeZone] = await Promise.all([
    getGroupCalendar(supabase, profile.org_id, group.id),
    getOrgTimeZone(),
  ]);

  return (
    <Suspense fallback={<div className="container mx-auto px-4 py-12 max-w-2xl">Loading...</div>}>
      <NewEventForm
        groupId={group.id}
        groupName={group.name}
        orgId={profile.org_id}
        calendarId={calendar?.id ?? null}
        timeZone={timeZone}
      />
    </Suspense>
  );
}
