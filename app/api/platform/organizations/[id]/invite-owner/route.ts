import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/platform-access";
import { sendFirstAdminInvite } from "../../firstAdminInvite";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/platform/organizations/[id]/invite-owner — send or resend the
 * first admin's invite. Re-sending re-mints the token, which invalidates the
 * previous link; the church page says so.
 */
export async function POST(request: Request, { params }: RouteParams) {
  const gate = await requirePlatformAdmin();
  if (!gate.ok) {
    return NextResponse.json(
      { error: gate.status === 401 ? "Unauthorized" : "Forbidden" },
      { status: gate.status }
    );
  }

  const { id } = await params;

  let body: { ownerEmail?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const ownerEmail = typeof body.ownerEmail === "string" ? body.ownerEmail.trim() : "";
  if (!ownerEmail) {
    return NextResponse.json({ error: "Enter the first admin's email." }, { status: 400 });
  }

  const result = await sendFirstAdminInvite({
    orgId: id,
    email: ownerEmail,
    operatorId: gate.user.id,
  });
  if (result.sent) return NextResponse.json({ success: true });

  switch (result.reason) {
    case "not_found":
      return NextResponse.json(
        { error: "No first admin found for this organization." },
        { status: 404 }
      );
    case "limit":
      // 409 so the church page shows this text rather than a generic failure.
      return NextResponse.json(
        {
          error:
            "This organization has reached today's email limit. Raise the limit on this page or send the invite tomorrow.",
        },
        { status: 409 }
      );
    case "failed":
      return NextResponse.json({ error: "Couldn't send the invite. Try again." }, { status: 500 });
  }
}
