import { NextResponse } from "next/server";
import { requireOrgAdmin } from "@/lib/members/access";
import { findExistingInvitees, sendMemberInvite } from "@/lib/members/invite";
import { normalizeEmail } from "@/lib/members/invite-form";

export async function POST(request: Request) {
  const gate = await requireOrgAdmin();
  if (!gate.ok) {
    return NextResponse.json(
      { error: gate.status === 401 ? "Unauthorized" : "Forbidden" },
      { status: gate.status }
    );
  }

  let body: { emails?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { emails } = body;

  if (
    !Array.isArray(emails) ||
    emails.length === 0 ||
    !emails.every((e): e is string => typeof e === "string")
  ) {
    return NextResponse.json(
      { error: "emails must be a non-empty array" },
      { status: 400 }
    );
  }

  const normalizedEmails = [...new Set(emails.map(normalizeEmail).filter(Boolean))];

  let existing;
  try {
    existing = await findExistingInvitees(gate.orgId, normalizedEmails);
  } catch (err) {
    console.error(
      "invite-bulk: existing-member check failed (org=%s):",
      gate.orgId,
      err instanceof Error ? err.name : typeof err
    );
    return NextResponse.json({ error: "Failed to send invites." }, { status: 500 });
  }

  let sent = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const email of normalizedEmails) {
    if (existing.accounts.has(email) || existing.invited.has(email)) {
      skipped++;
      continue;
    }

    const ok = await sendMemberInvite({
      orgId: gate.orgId,
      invitedBy: gate.user.id,
      email,
      // Placeholder until they enter their name during setup.
      name: email,
    });
    if (ok) {
      sent++;
    } else {
      errors.push(`${email}: the invite couldn't be sent`);
    }
  }

  return NextResponse.json({ sent, skipped, errors });
}
