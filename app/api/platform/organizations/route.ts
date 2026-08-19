import { NextResponse } from "next/server";
import { EMAIL } from "@/lib/branding";
import { isReservedOrgSlug } from "@/lib/org";
import { requirePlatformAdmin } from "@/lib/platform-access";
import { createServiceClient } from "@/lib/supabase/server";

// Mirrors provision_organization()'s TN003 regex so the operator gets a
// clean 400 before the RPC raises.
const SLUG = /^[a-z0-9][a-z0-9-]{1,62}$/;

export async function POST(request: Request) {
  const gate = await requirePlatformAdmin();
  if (!gate.ok) {
    return NextResponse.json(
      { error: gate.status === 401 ? "Unauthorized" : "Forbidden" },
      { status: gate.status }
    );
  }

  let body: { name?: unknown; slug?: unknown; ownerEmail?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  const ownerEmail = typeof body.ownerEmail === "string" ? body.ownerEmail.trim() : "";

  if (!name || !slug || !ownerEmail) {
    return NextResponse.json(
      { error: "Missing name, slug, or owner email" },
      { status: 400 }
    );
  }
  if (!SLUG.test(slug)) {
    return NextResponse.json(
      { error: "Slug must be lowercase letters, numbers, and hyphens." },
      { status: 400 }
    );
  }
  if (isReservedOrgSlug(slug)) {
    return NextResponse.json(
      { error: "That slug is reserved for platform use." },
      { status: 400 }
    );
  }
  // The owner email becomes the founding admin's identifier on the
  // access_requests row and is what the invite is later sent to, so a
  // malformed address here surfaces as a silent delivery failure much later.
  if (ownerEmail.length > 254 || !EMAIL.test(ownerEmail)) {
    return NextResponse.json(
      { error: "Enter a valid owner email address." },
      { status: 400 }
    );
  }

  try {
    // provision_organization() is EXECUTE-granted to service_role only; the
    // platform-admin gate above is the authorization decision. The RPC is
    // transactional — any raise rolls the whole provisioning back.
    const service = await createServiceClient();
    const { data: orgId, error } = await service.rpc("provision_organization", {
      _name: name,
      _slug: slug,
      _owner_email: ownerEmail,
    });

    if (error) {
      // The function's own errcodes, mapped to copy the form shows inline.
      if (error.code === "TN003") {
        return NextResponse.json(
          { error: "Slug must be lowercase letters, numbers, and hyphens." },
          { status: 400 }
        );
      }
      if (error.code === "TN004") {
        return NextResponse.json(
          { error: "That owner email already belongs to another organization." },
          { status: 409 }
        );
      }
      if (error.code === "TN005") {
        return NextResponse.json(
          {
            error:
              "That owner email already has an approved request or unclaimed invite elsewhere.",
          },
          { status: 409 }
        );
      }
      if (error.code === "TN006") {
        return NextResponse.json(
          { error: "That slug is reserved for platform use." },
          { status: 400 }
        );
      }
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "That slug is already taken." },
          { status: 409 }
        );
      }
      throw error;
    }

    return NextResponse.json({ success: true, orgId });
  } catch (error) {
    console.error("Organization create error:", error);
    return NextResponse.json(
      { error: "Failed to create organization" },
      { status: 500 }
    );
  }
}
