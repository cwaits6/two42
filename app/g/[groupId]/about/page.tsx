import { createClient } from "@/lib/supabase/server";
import { mintSignedUrls } from "@/lib/storageRead";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Video } from "lucide-react";
import { siteConfig } from "@/lib/config";
import { displayName, initials } from "@/lib/names";
import { getGroupSettings } from "@/lib/groups/settings";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StaticBlockContent } from "@/components/editor/StaticBlockContent";
import { parseStoredBlocks } from "@/components/editor/normalizeBlocks";
import type { AboutPage, ClassTeacherWithProfile } from "@/lib/types";
import { requireActiveGroup } from "@/lib/groups/server";

export const metadata = { title: `About | ${siteConfig.name}` };

export default async function AboutGroupPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const group = await requireActiveGroup(groupId);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, org_id")
    .eq("id", user.id)
    .single();
  if (!profile || profile.role === "pending") redirect("/dashboard");

  const [{ data: about }, { data: teachers }, settings] = await Promise.all([
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

  const summaryBlocks = parseStoredBlocks((about as AboutPage | null)?.body);
  // Private buckets: exchange stored avatar URLs for signed URLs
  // before they reach the AvatarImage renders below.
  const teacherRows = (teachers ?? []) as ClassTeacherWithProfile[];
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
    <div className="container mx-auto px-4 py-12 max-w-4xl">
      <h1 className="text-3xl md:text-4xl font-bold text-brand-primary mb-8">
        About {group.name}
      </h1>

      {summaryBlocks?.length ? (
        <StaticBlockContent blocks={summaryBlocks} />
      ) : (
        <p className="text-lg text-muted-foreground">
          The group summary hasn&apos;t been written yet.
        </p>
      )}

      {(videoCallUrl || settings.zoom_meeting_time) && (
        <Card className="mt-12">
          <CardContent className="py-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <h2 className="flex items-center gap-2 text-2xl font-bold text-brand-primary">
                  <Video className="h-6 w-6" aria-hidden="true" />
                  Weekly video call
                </h2>
                {settings.zoom_meeting_time && (
                  <p className="mt-1 text-lg text-foreground">{settings.zoom_meeting_time}</p>
                )}
                {videoCallUrl && (
                  <p className="mt-1 break-all text-base text-muted-foreground">{videoCallUrl}</p>
                )}
              </div>
              {videoCallUrl && (
                <Button
                  size="lg"
                  nativeButton={false}
                  render={<Link href={videoCallUrl} target="_blank" rel="noopener noreferrer" />}
                  className="shrink-0 bg-brand-primary text-white hover:bg-brand-primary/90"
                >
                  Join video call
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="mt-12">
        <h2 className="text-2xl md:text-3xl font-bold text-brand-primary mb-6">
          Leadership
        </h2>

        {teacherList.length === 0 ? (
          <p className="text-lg text-muted-foreground">
            Leadership info hasn&apos;t been added yet.
          </p>
        ) : (
          <div className="space-y-6">
            {teacherList.map((teacher) => (
              <Card key={teacher.id}>
                <CardContent className="py-6">
                  <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5">
                    <Avatar className="h-24 w-24 shrink-0 border-2 border-brand-accent">
                      {teacher.profiles?.avatar_url && (
                        <AvatarImage
                          src={teacher.profiles.avatar_url}
                          alt={`Photo of ${displayName(teacher.profiles)}`}
                        />
                      )}
                      <AvatarFallback className="bg-brand-primary text-white text-2xl">
                        {initials(teacher.profiles)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 text-center sm:text-left">
                      <h3 className="text-xl font-semibold">
                        {displayName(teacher.profiles)}
                      </h3>
                      <p className="text-base font-medium uppercase tracking-wider text-brand-primary mb-2">
                        {teacher.title}
                      </p>
                      {teacher.bio ? (
                        <p className="text-base text-foreground/90 whitespace-pre-line">
                          {teacher.bio}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
