/**
 * POST /api/admin/members/invite — invite one person to the church.
 *
 * Body: { email, firstName, lastName, householdId? }. Field problems come
 * back as `fieldErrors` keyed by field, so the form can show each one under
 * its input; nothing here returns a database or provider message.
 */
import { NextResponse } from "next/server";
import { requireOrgAdmin } from "@/lib/members/access";
import { findExistingInvitees, sendMemberInvite } from "@/lib/members/invite";
import { validateInvitePerson } from "@/lib/members/invite-form";

const NO_STORE = { "Cache-Control": "no-store" } as const;

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export async function POST(request: Request) {
  const gate = await requireOrgAdmin();
  if (!gate.ok) {
    return json(
      { error: gate.status === 401 ? "Unauthorized" : "Forbidden" },
      gate.status
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const { input, errors } = validateInvitePerson(body);
  if (Object.keys(errors).length > 0) {
    return json({ fieldErrors: errors }, 400);
  }

  let existing;
  try {
    existing = await findExistingInvitees(gate.orgId, [input.email]);
  } catch (err) {
    console.error(
      "members invite: existing-account check failed (org=%s):",
      gate.orgId,
      err instanceof Error ? err.name : typeof err
    );
    return json({ error: "Couldn't send the invite. Try again." }, 500);
  }
  if (existing.accounts.has(input.email)) {
    return json(
      { fieldErrors: { email: "This email already has an account. No invite was sent." } },
      409
    );
  }
  if (existing.invited.has(input.email)) {
    return json(
      {
        fieldErrors: {
          email:
            "This email already has an invite or a request to join. No invite was sent.",
        },
      },
      409
    );
  }

  const sent = await sendMemberInvite({
    orgId: gate.orgId,
    invitedBy: gate.user.id,
    email: input.email,
    name: `${input.firstName} ${input.lastName}`,
    household: input.householdId
      ? { id: input.householdId, firstName: input.firstName, lastName: input.lastName }
      : undefined,
  });
  if (!sent) {
    return json({ error: "Couldn't send the invite. Try again." }, 500);
  }

  return json({ sent: true }, 200);
}
