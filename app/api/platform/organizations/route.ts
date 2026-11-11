import { NextResponse } from "next/server";
import { EMAIL, EMAIL_MAX_LENGTH } from "@/lib/branding";
import { requirePlatformAdmin } from "@/lib/platform-access";
import { createServiceClient } from "@/lib/supabase/server";
import { logError } from "@/lib/log";
import { normalizeEmail } from "@/lib/sanitize";
import type { AddOrganizationResponse } from "./addOrganizationResponse";
import { sendFirstAdminInvite } from "./firstAdminInvite";

export async function POST(request: Request) {
  const gate = await requirePlatformAdmin();
  if (!gate.ok) {
    return NextResponse.json(
      { error: gate.status === 401 ? "Unauthorized" : "Forbidden" },
      { status: gate.status }
    );
  }

  let body: { name?: unknown; ownerEmail?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const ownerEmail = normalizeEmail(
    typeof body.ownerEmail === "string" ? body.ownerEmail : null,
  );

  if (!name) {
    return NextResponse.json({ error: "Enter the organization's name." }, { status: 400 });
  }
  if (!ownerEmail) {
    return NextResponse.json({ error: "Enter the first admin's email." }, { status: 400 });
  }
  // The first admin's email is what the invite is sent to, so a malformed
  // address here would only surface as a failed delivery.
  if (ownerEmail.length > EMAIL_MAX_LENGTH || !EMAIL.test(ownerEmail)) {
    return NextResponse.json(
      { error: "Enter an email address like name@example.com." },
      { status: 400 }
    );
  }

  try {
    // provision_organization() is EXECUTE-granted to service_role only; the
    // platform-admin gate above is the authorization decision. The RPC is
    // transactional — any raise rolls the whole provisioning back.
    const service = await createServiceClient();
    // org-anchor: this RPC creates the organization and derives its org_id
    // transactionally — there is no existing org_id to filter on
    const { data: orgId, error } = await service.rpc("provision_organization", {
      _name: name,
      _owner_email: ownerEmail,
    });

    if (error) {
      // The function's own errcodes, mapped to copy the form shows inline.
      if (error.code === "TN004") {
        return NextResponse.json(
          { error: "That email already belongs to another organization." },
          { status: 409 }
        );
      }
      if (error.code === "TN005") {
        return NextResponse.json(
          {
            error:
              "That email already has an invite or an approved request in another organization.",
          },
          { status: 409 }
        );
      }
      throw error;
    }

    // A repeat or a retry that starts after this request committed is refused
    // above with TN005. Two requests for the same email at the same moment can
    // both pass that check and both send: closing that needs a lock or unique
    // index in provision_organization(). The church is added whatever the
    // invite's outcome; its page offers Send invite when it wasn't sent.
    const invite = await sendFirstAdminInvite({
      orgId,
      email: ownerEmail,
      operatorId: gate.user.id,
    });
    const added: AddOrganizationResponse = { success: true, orgId, inviteSent: invite.sent };
    return NextResponse.json(added);
  } catch (error) {
    logError("Organization create error", error, { route: "/api/platform/organizations" });
    return NextResponse.json(
      { error: "Failed to create organization" },
      { status: 500 }
    );
  }
}
