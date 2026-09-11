import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/platform-access";
import { createServiceClient } from "@/lib/supabase/server";
import { CONTROL, EMAIL, validateAccent } from "@/lib/branding";
import type { Database } from "@/lib/supabase/database.types";

type OrgStatus = Database["public"]["Enums"]["org_status"];

interface RouteParams {
  params: Promise<{ id: string }>;
}

// The enum union, enforced by tsc: adding a label to org_status without
// listing it here is a compile error via the satisfies check.
const ORG_STATUSES = ["active", "suspended"] as const satisfies readonly OrgStatus[];

function isOrgStatus(value: unknown): value is OrgStatus {
  return (ORG_STATUSES as readonly string[]).includes(value as string);
}

/**
 * Validate one branding key from the PATCH body into its stored shape, or
 * return an error string. Empty strings clear a key back to null (the read
 * path then falls back), except display_name, which must not persist empty.
 */
function validateBrandingPatch(
  raw: Record<string, unknown>
): { ok: true; branding: Record<string, string | null> } | { ok: false; error: string } {
  const branding: Record<string, string | null> = {};

  if ("display_name" in raw) {
    if (typeof raw.display_name !== "string") {
      return { ok: false, error: "Display name must be text." };
    }
    const name = raw.display_name.replace(CONTROL, "").trim();
    if (name === "") {
      return { ok: false, error: "Display name cannot be empty." };
    }
    branding.display_name = name;
  }

  if ("accent" in raw) {
    if (typeof raw.accent !== "string") {
      return { ok: false, error: "Accent must be a 6-digit hex color such as #B85C38." };
    }
    if (raw.accent.trim() === "") {
      branding.accent = null;
    } else {
      const result = validateAccent(raw.accent.trim());
      if (!result.ok) return { ok: false, error: result.reason };
      branding.accent = result.accent;
    }
  }

  if ("logo_url" in raw) {
    if (typeof raw.logo_url !== "string") {
      return { ok: false, error: "Logo URL must be text." };
    }
    const logoUrl = raw.logo_url.trim();
    if (logoUrl === "") {
      branding.logo_url = null;
    } else {
      let parsed: URL;
      try {
        parsed = new URL(logoUrl);
      } catch {
        return { ok: false, error: "Logo URL must be a valid http(s) URL." };
      }
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        return { ok: false, error: "Logo URL must be a valid http(s) URL." };
      }
      branding.logo_url = logoUrl;
    }
  }

  if ("reply_to" in raw) {
    if (typeof raw.reply_to !== "string") {
      return { ok: false, error: "Reply-to must be an email address." };
    }
    const replyTo = raw.reply_to.trim();
    if (replyTo === "") {
      branding.reply_to = null;
    } else if (replyTo.length > 254 || !EMAIL.test(replyTo)) {
      return { ok: false, error: "Reply-to must be a valid email address." };
    } else {
      branding.reply_to = replyTo;
    }
  }

  return { ok: true, branding };
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const gate = await requirePlatformAdmin();
  if (!gate.ok) {
    return NextResponse.json(
      { error: gate.status === 401 ? "Unauthorized" : "Forbidden" },
      { status: gate.status }
    );
  }

  const { id } = await params;

  let body: { status?: unknown; branding?: unknown; custom_email_domain_enabled?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const update: {
    status?: OrgStatus;
    branding?: Record<string, unknown>;
    custom_email_domain_enabled?: boolean;
  } = {};

  if ("status" in body) {
    if (!isOrgStatus(body.status)) {
      return NextResponse.json(
        { error: "Status must be active or suspended" },
        { status: 400 }
      );
    }
    update.status = body.status;
  }

  // Platform-operator-only gate on custom sending domains: a plain boolean
  // pass-through here is the only write path for it (the column has no
  // grant to the org's own admin).
  if ("custom_email_domain_enabled" in body) {
    if (typeof body.custom_email_domain_enabled !== "boolean") {
      return NextResponse.json(
        { error: "custom_email_domain_enabled must be true or false" },
        { status: 400 }
      );
    }
    update.custom_email_domain_enabled = body.custom_email_domain_enabled;
  }

  let brandingPatch: Record<string, string | null> | null = null;
  if ("branding" in body) {
    if (typeof body.branding !== "object" || body.branding === null || Array.isArray(body.branding)) {
      return NextResponse.json({ error: "Branding must be an object" }, { status: 400 });
    }
    const result = validateBrandingPatch(body.branding as Record<string, unknown>);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    brandingPatch = result.branding;
  }

  if (
    update.status === undefined &&
    update.custom_email_domain_enabled === undefined &&
    brandingPatch === null
  ) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  try {
    // organizations is the tenant root: the .eq("id", id) below is the same
    // documented exception lib/email/identity.ts uses, anchored on the
    // platform-admin gate above. See docs/security/service-role-inventory.md.
    const service = await createServiceClient();

    if (brandingPatch !== null) {
      // Merge onto the current row rather than replacing — editing accent
      // must not wipe reply_to.
      const { data: current, error: readError } = await service
        .from("organizations")
        .select("branding")
        .eq("id", id)
        .maybeSingle();
      if (readError) throw readError;
      if (!current) {
        return NextResponse.json({ error: "Organization not found" }, { status: 404 });
      }
      const existing =
        typeof current.branding === "object" &&
        current.branding !== null &&
        !Array.isArray(current.branding)
          ? (current.branding as Record<string, unknown>)
          : {};
      update.branding = { ...existing, ...brandingPatch };
    }

    const { data: updated, error } = await service
      .from("organizations")
      .update(update)
      .eq("id", id)
      .select("id");
    if (error) throw error;
    if (!updated || updated.length === 0) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Organization update error:", error);
    return NextResponse.json(
      { error: "Failed to update organization" },
      { status: 500 }
    );
  }
}
