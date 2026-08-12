import { createClient } from "@/lib/supabase/server";
import { mintSignedUrls } from "@/lib/storageRead";
import { redirect } from "next/navigation";
import { siteConfig } from "@/lib/config";
import { AboutEditor } from "./AboutEditor";
import type { AboutPage, ClassTeacherWithProfile } from "@/lib/types";

export const metadata = { title: `Edit About Page | ${siteConfig.name}` };

export default async function AdminAboutPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || !["admin", "content_editor"].includes(profile.role)) {
    redirect("/dashboard");
  }

  const [{ data: about }, { data: teachers }] = await Promise.all([
    supabase.from("about_page").select("*").maybeSingle(),
    supabase
      .from("class_teachers")
      .select(
        "*, profiles(id, first_name, last_name, preferred_name, avatar_url)",
      )
      .order("sort_order")
      .order("created_at"),
  ]);

  // Private buckets (CWA-59): exchange stored avatar URLs for signed URLs
  // before they reach the editor's AvatarImage renders.
  const teacherRows = (teachers ?? []) as ClassTeacherWithProfile[];
  const signedAvatars = await mintSignedUrls(
    teacherRows.map((t) => t.profiles?.avatar_url),
  );
  const teacherList = teacherRows.map((t, i) => ({
    ...t,
    profiles: t.profiles ? { ...t.profiles, avatar_url: signedAvatars[i] } : t.profiles,
  }));

  return (
    <AboutEditor
      initialBody={(about as AboutPage | null)?.body ?? ""}
      initialTeachers={teacherList}
    />
  );
}
