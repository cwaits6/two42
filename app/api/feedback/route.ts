import { createClient, createServiceClient } from "@/lib/supabase/server";
import { sendFeedbackEmail } from "@/lib/email/resend";
import { resolveEmailBranding } from "@/lib/email/identity";
import { reserveEmailQuota } from "@/lib/email/quota";
import { displayName } from "@/lib/names";
import { NextResponse, after } from "next/server";

// Per-user submission cap. Feedback is a low-volume form; this keeps a
// stuck client or a hostile script from flooding the table and admin inboxes.
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60 * 60 * 1000;

export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // org_id is read on the authenticated client, so RLS scopes it to the
  // caller's own org — it anchors the service-role reads below.
  const { data: profile } = await supabase
    .from("profiles")
    .select("org_id, role, first_name, last_name, preferred_name")
    .eq("id", user.id)
    .single();

  if (
    !profile ||
    !["member", "content_editor", "admin"].includes(profile.role)
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const type = body?.type;
  const message = typeof body?.message === "string" ? body.message.trim() : "";

  if (
    (type !== "idea" && type !== "problem") ||
    !message ||
    message.length > 2000
  ) {
    return NextResponse.json({ error: "Invalid feedback" }, { status: 400 });
  }

  // Throttle per user. RLS only lets admins read feedback rows, so the
  // count runs on the service client. Fails open — a broken count
  // shouldn't block feedback.
  const service = await createServiceClient();
  const windowStart = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
  const { count, error: countError } = await service
    .from("feedback")
    .select("id", { count: "exact", head: true })
    .eq("profile_id", user.id)
    .eq("org_id", profile.org_id)
    .gte("created_at", windowStart);
  if (countError) {
    console.error("Failed to check feedback rate limit:", countError);
  } else if ((count ?? 0) >= RATE_LIMIT) {
    return NextResponse.json(
      { error: "Too many submissions — please try again later" },
      { status: 429 },
    );
  }

  const { error: insertError } = await supabase
    .from("feedback")
    .insert({ profile_id: user.id, type, message });

  if (insertError) {
    console.error("Failed to store feedback:", insertError);
    return NextResponse.json(
      { error: "Failed to save feedback" },
      { status: 500 },
    );
  }

  // Email a copy to the admins — best effort, the row above is the record.
  // Runs after the response so a slow email provider never delays the user.
  // Uses the service client: the user client's request-scoped cookie store
  // isn't reliable once the response has been sent.
  after(async () => {
    try {
      // org_id filter is required: this is an email fan-out on a service-role
      // client — a role-only read mails every org's admins a copy of one
      // org's feedback.
      const { data: admins } = await service
        .from("profiles")
        .select("email")
        .eq("role", "admin")
        .eq("org_id", profile.org_id)
        .not("email", "is", null);
      const emails = (admins ?? [])
        .map((a) => a.email)
        .filter((e): e is string => Boolean(e));
      if (emails.length === 0) return;

      // Reserve the filtered batch against the org's daily cap before
      // sending. A refusal is a skip, never an error — the
      // feedback row above is the record either way.
      const allowed = await reserveEmailQuota(profile.org_id, emails.length);
      if (!allowed) {
        console.warn(
          "Feedback admin notification skipped — org %s hit its daily email cap",
          profile.org_id,
        );
        return;
      }

      // Branding for the sender's own org (the RLS-scoped profile above) —
      // never the request org, which on a custom domain could differ.
      await sendFeedbackEmail(
        emails,
        displayName(profile),
        user.email ?? null,
        type,
        message,
        await resolveEmailBranding(profile.org_id),
      );
    } catch (error) {
      console.error("Failed to email feedback to admins:", error);
    }
  });

  return NextResponse.json({ ok: true });
}
