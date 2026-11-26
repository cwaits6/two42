import { NextResponse } from "next/server";
import crypto from "crypto";
import { hashSubscriptionToken, subscriptionTokenExpiryDate } from "@/lib/calendar/subscription-token";
import { logError } from "@/lib/log";
import { isMemberRole } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";

/**
 * Makes the person's Supper club calendar link, or a new one. Only the
 * token's hash is kept, and replacing it ends the old link.
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (!profile || !isMemberRole(profile.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = crypto.randomUUID();
  const { data, error } = await supabase
    .from("supper_feed_tokens")
    .upsert(
      { profile_id: user.id, token_hash: hashSubscriptionToken(token), expires_at: subscriptionTokenExpiryDate() },
      { onConflict: "profile_id" }
    )
    .select("profile_id");
  if (error || !data?.length) {
    if (error) logError("Failed to make a Supper club calendar link", error, { route: "/api/supper-club/feed-token" });
    return NextResponse.json({ error: "Failed to create link" }, { status: 500 });
  }
  return NextResponse.json({ token });
}
