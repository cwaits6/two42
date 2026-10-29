import { NextResponse } from "next/server";
import crypto from "crypto";
import { createClient } from "@/lib/supabase/server";
import {
  hashSubscriptionToken,
  subscriptionTokenExpiryDate,
} from "@/lib/calendar/subscription-token";
import { isMemberRole } from "@/lib/roles";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || !isMemberRole(profile.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = crypto.randomUUID();

  const { error } = await supabase
    .from("calendar_subscription_tokens")
    .upsert(
      {
        user_id: user.id,
        token_hash: hashSubscriptionToken(token),
        expires_at: subscriptionTokenExpiryDate(),
      },
      { onConflict: "user_id" }
    );

  if (error) {
    console.error("Failed to create calendar subscription token:", error);
    return NextResponse.json({ error: "Failed to create link" }, { status: 500 });
  }

  return NextResponse.json({ token });
}
