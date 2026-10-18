import { Suspense } from "react";
import { redirect } from "next/navigation";
import { NewEventForm } from "@/components/events/NewEventForm";
import { createClient } from "@/lib/supabase/server";
import { getGroupCalendar } from "@/lib/groups/calendar";
import { requireGroupLeader } from "@/lib/groups/server";
import { siteConfig } from "@/lib/config";

export const metadata = { title: `Create Event | ${siteConfig.name}` };

export default async function NewEventPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const group = await requireGroupLeader(groupId);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("org_id")
    .eq("id", user.id)
    .single();
  if (!profile) redirect("/dashboard");

  const calendar = await getGroupCalendar(supabase, profile.org_id, group.id);

  return (
    <Suspense fallback={<div className="container mx-auto px-4 py-12 max-w-2xl">Loading...</div>}>
      <NewEventForm
        groupId={group.id}
        groupName={group.name}
        orgId={profile.org_id}
        calendarId={calendar?.id ?? null}
      />
    </Suspense>
  );
}
