import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { siteConfig } from "@/lib/config";
import { orgBaseUrl } from "@/lib/org-urls";
import { Resend } from "resend";
import crypto from "crypto";

function getResend() {
  return new Resend(process.env.RESEND_API_KEY);
}

export async function POST(request: Request) {
  const supabase = await createClient();

  // Verify the caller is an admin
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, org_id")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { emails?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { emails } = body as { emails: string[] };

  if (!Array.isArray(emails) || emails.length === 0) {
    return NextResponse.json(
      { error: "emails must be a non-empty array" },
      { status: 400 }
    );
  }

  // Normalize emails
  const normalizedEmails = emails.map((e) => e.trim().toLowerCase()).filter(Boolean);

  // Fetch existing profiles by email to skip already-joined members
  const { data: existingProfiles } = await supabase
    .from("profiles")
    .select("email")
    .in("email", normalizedEmails);

  const existingEmailSet = new Set(
    (existingProfiles || [])
      .map((p: { email: string | null }) => p.email?.toLowerCase())
      .filter(Boolean)
  );

  // Also check existing access_requests to avoid duplicate invites
  const { data: existingRequests } = await supabase
    .from("access_requests")
    .select("email")
    .in("email", normalizedEmails);

  const existingRequestSet = new Set(
    (existingRequests || [])
      .map((r: { email: string }) => r.email?.toLowerCase())
      .filter(Boolean)
  );

  // The signup link follows the admin's own org host (org_id read under RLS
  // above), not the deployment's env-pinned platform URL.
  const signupBaseUrl = `${await orgBaseUrl(profile.org_id)}/join`;
  const resend = getResend();

  let sent = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const email of normalizedEmails) {
    // Skip already-joined members
    if (existingEmailSet.has(email)) {
      skipped++;
      continue;
    }

    // Skip emails that already have a pending/approved request
    if (existingRequestSet.has(email)) {
      skipped++;
      continue;
    }

    try {
      // Create an access_requests row with status='approved' so they can sign up directly
      const signupToken = crypto.randomBytes(32).toString("hex");
      const tokenExpiresAt = new Date(
        Date.now() + 14 * 24 * 60 * 60 * 1000
      ).toISOString();

      const { error: insertError } = await supabase
        .from("access_requests")
        .insert({
          email,
          name: email, // placeholder name — they'll fill it in during setup
          status: "approved",
          reviewed_by: user.id,
          reviewed_at: new Date().toISOString(),
          signup_token: signupToken,
          token_expires_at: tokenExpiresAt,
        });

      if (insertError) {
        errors.push(`${email}: ${insertError.message}`);
        continue;
      }

      const signupUrl = `${signupBaseUrl}?token=${signupToken}&email=${encodeURIComponent(email)}`;

      const { error: emailError } = await resend.emails.send({
        from: siteConfig.email.from,
        to: email,
        subject: `You're invited to join ${siteConfig.name}!`,
        html: `
          <div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
            <h1 style="color: ${siteConfig.colors.primary}; font-size: 28px;">You're invited!</h1>
            <p style="font-size: 18px; line-height: 1.6; color: #44403c;">
              <strong>${siteConfig.name}</strong> has invited you to join our online community.
            </p>
            <p style="font-size: 18px; line-height: 1.6; color: #44403c;">
              Click the button below to create your account and get started.
            </p>
            <a href="${signupUrl}"
               style="display: inline-block; background-color: ${siteConfig.colors.primary}; color: white; padding: 16px 32px; text-decoration: none; border-radius: 8px; font-size: 18px; margin-top: 20px;">
              Join ${siteConfig.name}
            </a>
            <p style="font-size: 14px; color: #78716c; margin-top: 40px;">
              If the button doesn't work, copy and paste this link into your browser:<br />
              <a href="${signupUrl}" style="color: ${siteConfig.colors.primaryLight};">${signupUrl}</a>
            </p>
            <p style="font-size: 14px; color: #78716c; margin-top: 20px;">
              &mdash; The ${siteConfig.name} Team
            </p>
          </div>
        `,
      });

      if (emailError) {
        // Email failed — remove the access_request we just inserted
        await supabase
          .from("access_requests")
          .delete()
          .eq("email", email)
          .eq("signup_token", signupToken);
        errors.push(`${email}: failed to send email — ${emailError.message}`);
        continue;
      }

      sent++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`${email}: ${message}`);
    }
  }

  return NextResponse.json({ sent, skipped, errors });
}
