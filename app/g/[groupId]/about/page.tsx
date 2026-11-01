import { createClient } from "@/lib/supabase/server";
import { mintSignedUrls } from "@/lib/storageRead";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Users, Video } from "lucide-react";
import { displayName, initials } from "@/lib/names";
import { getGroupSettings } from "@/lib/groups/settings";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/states/EmptyState";
import { ErrorState } from "@/components/states/ErrorState";
import { StaticBlockContent } from "@/components/editor/StaticBlockContent";
import { parseStoredBlocks } from "@/components/editor/normalizeBlocks";
import type { AboutPage, ClassTeacherWithProfile } from "@/lib/types";
import { requireActiveGroup } from "@/lib/groups/server";
import { getOptionalUser } from "@/lib/supabase/current-user";
import { readList } from "@/lib/supabase/readList";
import { groupPath } from "@/lib/groups/active";
import { groupPageTitle } from "@/lib/pageTitle";

export const generateMetadata = groupPageTitle("About");

export default async function AboutGroupPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const group = await requireActiveGroup(groupId);
  const supabase = await createClient();
  const user = await getOptionalUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, org_id")
    .eq("id", user.id)
    .single();
  if (!profile || profile.role === "pending") redirect("/dashboard");

  const [aboutRead, teachersRead, settings] = await Promise.all([
    supabase.from("about_page").select("*").eq("group_id", group.id).maybeSingle(),
    supabase
      .from("class_teachers")
      .select(
        "*, profiles(id, first_name, last_name, preferred_name, avatar_url)",
      )
      .eq("group_id", group.id)
      .order("sort_order")
      .order("created_at"),
    getGroupSettings(supabase, profile.org_id, group.id),
  ]);

  const isLeader = group.role === "leader";
  const editLink = isLeader ? (
    <Button
      variant="outline"
      nativeButton={false}
      render={<Link href={groupPath(group.id, "/settings/about")} />}
    >
      Edit page
    </Button>
  ) : undefined;

  const teacherRows = readList<ClassTeacherWithProfile>(teachersRead, "the group's leadership");
  if (aboutRead.error) {
    console.error("Failed to load the group's summary: code=%s", aboutRead.error.code);
  }
  if (!teacherRows || aboutRead.error) {
    return (
      <PageContainer>
        <PageHeader title={`About ${group.name}`} actions={editLink} />
        <ErrorState thing="this page" />
      </PageContainer>
    );
  }

  const summaryBlocks = parseStoredBlocks((aboutRead.data as AboutPage | null)?.body);
  // Private buckets: exchange stored avatar URLs for signed URLs
  // before they reach the AvatarImage renders below.
  const signedAvatars = await mintSignedUrls(
    teacherRows.map((t) => t.profiles?.avatar_url),
  );
  const teacherList = teacherRows.map((t, i) => ({
    ...t,
    profiles: t.profiles ? { ...t.profiles, avatar_url: signedAvatars[i] } : t.profiles,
  }));

  // Only an https link reaches an anchor; the editor enforces the same rule.
  const videoCallUrl = settings.weekly_zoom_url?.startsWith("https://")
    ? settings.weekly_zoom_url
    : null;

  return (
    <PageContainer>
      <PageHeader title={`About ${group.name}`} actions={editLink} />

      {summaryBlocks?.length ? (
        <StaticBlockContent blocks={summaryBlocks} />
      ) : (
        <p className="text-lg text-muted-foreground">
          The group summary hasn&apos;t been written yet.
        </p>
      )}

      {(videoCallUrl || settings.zoom_meeting_time) && (
        <Card className="mt-10">
          <CardContent className="py-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <h2 className="flex items-center gap-2 text-xl font-bold text-foreground">
                  <Video className="h-6 w-6 text-brand-primary-text" aria-hidden="true" />
                  Weekly video call
                </h2>
                {settings.zoom_meeting_time && (
                  <p className="mt-1 text-lg text-foreground">{settings.zoom_meeting_time}</p>
                )}
              </div>
              {videoCallUrl && (
                <Button
                  size="lg"
                  nativeButton={false}
                  render={<Link href={videoCallUrl} target="_blank" rel="noopener noreferrer" />}
                  className="shrink-0"
                >
                  Join video call
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <section className="mt-10">
        <h2 className="mb-4 text-xl font-bold text-foreground">Leadership</h2>

        {teacherList.length === 0 ? (
          <EmptyState
            icon={Users}
            message="No one listed yet."
            action={
              isLeader ? (
                <Button
                  variant="outline"
                  nativeButton={false}
                  render={<Link href={groupPath(group.id, "/settings/about")} />}
                >
                  Add member
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="space-y-4">
            {teacherList.map((teacher) => (
              <li key={teacher.id}>
                <Card>
                  <CardContent className="flex flex-col items-start gap-4 py-6 sm:flex-row">
                    <Avatar className="h-16 w-16 shrink-0 sm:h-20 sm:w-20">
                      {teacher.profiles?.avatar_url && (
                        <AvatarImage
                          src={teacher.profiles.avatar_url}
                          alt={`Photo of ${displayName(teacher.profiles)}`}
                        />
                      )}
                      <AvatarFallback className="bg-brand-primary text-white text-xl">
                        {initials(teacher.profiles)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <h3 className="text-lg font-semibold text-foreground">
                        {displayName(teacher.profiles)}
                      </h3>
                      {teacher.title && (
                        <p className="text-base text-muted-foreground">{teacher.title}</p>
                      )}
                      {teacher.bio && (
                        <p className="mt-2 max-w-prose text-base text-foreground whitespace-pre-line">
                          {teacher.bio}
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </PageContainer>
  );
}
