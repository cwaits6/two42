import { createClient } from "@/lib/supabase/server";
import { mintSignedUrl, mintSignedUrls } from "@/lib/storageRead";
import { redirect } from "next/navigation";
import { siteConfig } from "@/lib/config";
import { displayName, initials } from "@/lib/names";
import { loadFundFormData } from "@/lib/giving/server";
import { PrayerBoard } from "@/components/prayer/PrayerBoard";
import type { PrayerCallSession, PrayerWallRow } from "@/lib/types";

export const metadata = { title: `Prayer | ${siteConfig.name}` };

export default async function PrayerPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, first_name, last_name, preferred_name, avatar_url")
    .eq("id", user.id)
    .single();
  if (!profile || profile.role === "pending") redirect("/dashboard");
  const isAdmin = profile.role === "admin";

  const [
    { data: requests, error: requestsError },
    { data: sessions, error: sessionsError },
    { members },
    { data: calSetting },
  ] = await Promise.all([
    supabase
      .from("prayer_wall")
      .select("*")
      .order("created_at", { ascending: false }),
    supabase
      .from("prayer_call_sessions")
      .select("*")
      .order("display_order")
      .order("created_at"),
    loadFundFormData(supabase),
    supabase
      .from("site_settings")
      .select("value")
      .eq("key", "prayer_calendar_id")
      .maybeSingle(),
  ]);
  if (requestsError) {
    console.error("Failed to fetch prayer requests:", requestsError);
    throw new Error("Failed to load the prayer wall.");
  }
  if (sessionsError) {
    console.error("Failed to fetch prayer call sessions:", sessionsError);
  }

  // Private buckets (CWA-59): exchange stored avatar URLs for signed URLs
  // before the wall rows and the composer's "me" reach client renders.
  const wallRows = (requests ?? []) as PrayerWallRow[];
  const [signedWallAvatars, myAvatarUrl] = await Promise.all([
    mintSignedUrls(wallRows.map((r) => r.avatar_url)),
    mintSignedUrl(profile.avatar_url),
  ]);
  const signedRequests = wallRows.map((r, i) => ({
    ...r,
    avatar_url: signedWallAvatars[i],
  }));

  return (
    <div className="container mx-auto px-4 py-12 max-w-6xl">
      <h1 className="text-3xl md:text-4xl font-bold text-brand-primary mb-2">
        Prayer
      </h1>
      <p className="text-lg text-muted-foreground max-w-2xl">
        Post a request with your name or anonymously.
      </p>

      <div className="mt-10">
        <PrayerBoard
          initialRequests={signedRequests}
          sessions={(sessions ?? []) as PrayerCallSession[]}
          me={{
            id: user.id,
            name: displayName(profile),
            initials: initials(profile),
            avatarUrl: myAvatarUrl,
          }}
          isAdmin={isAdmin}
          members={members}
          prayerCalendarId={calSetting?.value ?? null}
        />
      </div>
    </div>
  );
}
