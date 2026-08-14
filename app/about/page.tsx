import { createClient } from "@/lib/supabase/server";
import { mintSignedUrls } from "@/lib/storageRead";
import { redirect } from "next/navigation";
import { siteConfig } from "@/lib/config";
import { displayName, initials } from "@/lib/names";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import { PageRenderer } from "@/app/pages/[slug]/PageRenderer";
import type { AboutPage, ClassTeacherWithProfile } from "@/lib/types";

export const metadata = { title: `About Our Class | ${siteConfig.name}` };

export default async function AboutClassPage() {
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
  if (!profile || profile.role === "pending") redirect("/dashboard");

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

  const summary = (about as AboutPage | null)?.body ?? "";
  const hasSummary = (() => {
    try {
      const parsed = JSON.parse(summary);
      return Array.isArray(parsed) && parsed.length > 0;
    } catch {
      return false;
    }
  })();
  // Private buckets (CWA-59): exchange stored avatar URLs for signed URLs
  // before they reach the AvatarImage renders below.
  const teacherRows = (teachers ?? []) as ClassTeacherWithProfile[];
  const signedAvatars = await mintSignedUrls(
    teacherRows.map((t) => t.profiles?.avatar_url),
  );
  const teacherList = teacherRows.map((t, i) => ({
    ...t,
    profiles: t.profiles ? { ...t.profiles, avatar_url: signedAvatars[i] } : t.profiles,
  }));

  return (
    <div className="container mx-auto px-4 py-12 max-w-4xl">
      <h1 className="text-3xl md:text-4xl font-bold text-brand-primary mb-8">
        About Our Class
      </h1>

      {hasSummary ? (
        <PageRenderer body={summary} />
      ) : (
        <p className="text-lg text-muted-foreground">
          The class summary hasn&apos;t been written yet.
        </p>
      )}

      <div className="mt-12">
        <h2 className="text-2xl md:text-3xl font-bold text-brand-primary mb-6">
          Our Teachers
        </h2>

        {teacherList.length === 0 ? (
          <p className="text-lg text-muted-foreground">
            Teacher info hasn&apos;t been added yet.
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
