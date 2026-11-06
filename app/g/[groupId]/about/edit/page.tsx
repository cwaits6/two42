import { createClient } from "@/lib/supabase/server";
import { mintSignedUrls } from "@/lib/storageRead";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { ErrorState } from "@/components/states/ErrorState";
import { groupPath } from "@/lib/groups/active";
import { requireGroupLeader } from "@/lib/groups/server";
import { readList } from "@/lib/supabase/readList";
import { AboutEditor } from "./AboutEditor";
import type { AboutPage, ClassTeacherWithProfile } from "@/lib/types";
import { groupPageTitle } from "@/lib/pageTitle";
import { logError } from "@/lib/log";

export const generateMetadata = groupPageTitle("Edit About");

export default async function EditAboutPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const group = await requireGroupLeader(groupId);
  const supabase = await createClient();

  const [aboutRead, teachersRead] = await Promise.all([
    supabase.from("about_page").select("*").eq("group_id", group.id).maybeSingle(),
    supabase
      .from("class_teachers")
      .select(
        "*, profiles(id, first_name, last_name, preferred_name, avatar_url)",
      )
      .eq("group_id", group.id)
      .order("sort_order")
      .order("created_at"),
  ]);

  // Never open the editor on a failed read: its blanks would read as saved values.
  const teacherRows = readList<ClassTeacherWithProfile>(teachersRead, "the group's leadership");
  if (aboutRead.error) {
    logError("Failed to load the group's summary", aboutRead.error, { route: "/g/[groupId]/about/edit" });
  }
  if (!teacherRows || aboutRead.error) {
    return (
      <PageContainer>
        <PageHeader
          title="Edit About"
          subtitle={`Changes here apply to ${group.name} only.`}
          backHref={groupPath(group.id, "/about")}
          backLabel="Back to About"
        />
        <ErrorState thing="the About page" />
      </PageContainer>
    );
  }

  // Private buckets: exchange stored avatar URLs for signed URLs
  // before they reach the editor's AvatarImage renders.
  const signedAvatars = await mintSignedUrls(
    teacherRows.map((t) => t.profiles?.avatar_url),
  );
  const teacherList = teacherRows.map((t, i) => ({
    ...t,
    profiles: t.profiles ? { ...t.profiles, avatar_url: signedAvatars[i] } : t.profiles,
  }));

  return (
    <AboutEditor
      groupId={group.id}
      groupName={group.name}
      initialBody={(aboutRead.data as AboutPage | null)?.body ?? ""}
      initialTeachers={teacherList}
    />
  );
}
