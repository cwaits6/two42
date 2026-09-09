import { resolveTxt } from "node:dns/promises";
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireOrgAdmin } from "@/lib/members/access";
import { DOMAIN_ROW_COLUMNS, TXT_LABEL } from "@/lib/domains";
import { redactFailure } from "@/lib/members/apply";

/**
 * POST /api/admin/domains/[id]/verify — prove ownership of a claimed domain
 * by resolving the TXT record at _two42-verify.<domain> and comparing it to
 * the row's verification_token.
 *
 * Service-role because status / verified_at / last_checked_at are
 * server-set-only columns the admin's own client cannot UPDATE (no UPDATE
 * grant on any column). Org anchored on the caller's own RLS-scoped
 * profile: the target row is fetched `.eq("id", id).eq("org_id", orgId)`
 * before any write, and every write is scoped on `(id, org_id)`.
 *
 * Verification proves *ownership* only. Routing is the attachment worker's
 * job (supabase/functions/attach-org-domains), which is the sole writer of
 * attached_at; nothing here touches the attachment columns.
 */

// dns/promises is Node-only — not available in the Edge Runtime. Pinned
// here so a future default change cannot silently move this handler.
export const runtime = "nodejs";

// Per-org throttle, the feedback route's count-in-a-window pattern: rows
// whose last_checked_at falls inside the window. Without an attempts log
// that count is "distinct domains checked", so a per-row cooldown carries
// the per-attempt limit — together they bound DNS lookups per org.
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const ROW_COOLDOWN_MS = 30 * 1000;

// resolveTxt has no timeout of its own and route handlers do.
const DNS_TIMEOUT_MS = 5 * 1000;

type TxtLookup =
  | { ok: true; records: string[] }
  | { ok: false; reason: "no_record" | "timeout" | "lookup_failed" };

/**
 * Resolve every TXT record at `name`, joining each record's chunks — a
 * record longer than 255 bytes arrives split, and comparing only the first
 * chunk would never match. ENOTFOUND / ENODATA mean the record is not
 * published (yet); they are a diagnostic, not an error.
 */
async function lookupTxt(name: string): Promise<TxtLookup> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), DNS_TIMEOUT_MS);
  });
  try {
    const records = await Promise.race([resolveTxt(name), timeout]);
    return { ok: true, records: records.map((chunks) => chunks.join("")) };
  } catch (err) {
    const code = (err as { code?: unknown })?.code;
    if (code === "ENOTFOUND" || code === "ENODATA") {
      return { ok: false, reason: "no_record" };
    }
    if (err instanceof Error && err.message === "timeout") {
      return { ok: false, reason: "timeout" };
    }
    console.error("domain verify: DNS lookup failed for %s:", name, err);
    return { ok: false, reason: "lookup_failed" };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, { params }: RouteParams) {
  const gate = await requireOrgAdmin();
  if (!gate.ok) {
    return NextResponse.json(
      { error: gate.status === 401 ? "Unauthorized" : "Forbidden" },
      { status: gate.status },
    );
  }
  const { orgId } = gate;
  const { id } = await params;

  const service = await createServiceClient();

  try {
    // Throttle first — before the row read and long before any DNS lookup.
    // Fails open like the feedback route: a broken count must not block
    // verification.
    const windowStart = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
    const { count, error: countError } = await service
      .from("org_domains")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .gte("last_checked_at", windowStart);
    if (countError) {
      console.error("domain verify: rate-limit count failed (org=%s): %s", orgId, redactFailure(countError));
    } else if ((count ?? 0) >= RATE_LIMIT) {
      return NextResponse.json(
        { error: "Too many verification attempts. Try again in a few minutes." },
        { status: 429 },
      );
    }

    const { data: row, error: rowError } = await service
      .from("org_domains")
      .select("id, domain, status, verification_token, last_checked_at")
      .eq("id", id)
      .eq("org_id", orgId)
      .maybeSingle();
    if (rowError) {
      console.error("domain verify: lookup error (org=%s, id=%s): %s", orgId, id, redactFailure(rowError));
      return NextResponse.json({ error: "Failed to verify domain." }, { status: 500 });
    }
    if (!row) {
      return NextResponse.json({ error: "Domain not found." }, { status: 404 });
    }

    if (row.status === "removing") {
      return NextResponse.json(
        { error: "This domain is being removed and cannot be verified." },
        { status: 409 },
      );
    }
    if (row.status === "verified") {
      return NextResponse.json({
        data: await reread(service, id, orgId),
        verified: true,
        message: "Domain is already verified.",
      });
    }
    if (
      row.last_checked_at &&
      Date.now() - new Date(row.last_checked_at).getTime() < ROW_COOLDOWN_MS
    ) {
      return NextResponse.json(
        { error: "Checked a moment ago. Wait 30 seconds before checking again." },
        { status: 429 },
      );
    }

    const lookup = await lookupTxt(`${TXT_LABEL}.${row.domain}`);
    const now = new Date().toISOString();
    const matched = lookup.ok && lookup.records.includes(row.verification_token);

    if (!matched) {
      // Stamp the attempt (it counts toward the throttle) and leave the
      // status alone: the claim stays visible for a retry.
      const { data: stamped, error: stampError } = await service
        .from("org_domains")
        .update({ last_checked_at: now })
        .eq("id", id)
        .eq("org_id", orgId)
        .select(DOMAIN_ROW_COLUMNS)
        .single();
      if (stampError || !stamped) {
        console.error("domain verify: last_checked_at stamp failed (org=%s, id=%s): %s", orgId, id, redactFailure(stampError));
        return NextResponse.json({ error: "Failed to record the check." }, { status: 500 });
      }
      return NextResponse.json({
        data: stamped,
        verified: false,
        diagnostic: diagnosticFor(lookup, row.domain),
      });
    }

    const { data: saved, error: updateError } = await service
      .from("org_domains")
      .update({ status: "verified", verified_at: now, last_checked_at: now })
      .eq("id", id)
      .eq("org_id", orgId)
      .select(DOMAIN_ROW_COLUMNS)
      .single();

    if (updateError || !saved) {
      // The global partial unique on verified/removing domains: another row
      // holds this name — most often a 'removing' tombstone whose Vercel
      // cleanup is still pending. Ownership was proven, so this is not a
      // DNS failure and must not read as one.
      if (updateError?.code === "23505") {
        return NextResponse.json(
          {
            error:
              "This domain is still being released by its previous owner, or is verified for another organization. Try again shortly.",
          },
          { status: 409 },
        );
      }
      console.error("domain verify: scoped update failed (org=%s, id=%s): %s", orgId, id, redactFailure(updateError));
      return NextResponse.json(
        { error: "Verified but failed to save status." },
        { status: 500 },
      );
    }

    return NextResponse.json({ data: saved, verified: true });
  } catch (err) {
    console.error("domain verify: unexpected error (org=%s, id=%s): %s", orgId, id, redactFailure(err));
    return NextResponse.json({ error: "Failed to verify domain." }, { status: 500 });
  }
}

function diagnosticFor(lookup: TxtLookup, domain: string): string {
  const name = `${TXT_LABEL}.${domain}`;
  if (lookup.ok) {
    return `A TXT record exists at ${name} but does not match the verification token. Check the value and try again.`;
  }
  switch (lookup.reason) {
    case "no_record":
      return `No TXT record found at ${name}. DNS changes can take up to an hour to propagate.`;
    case "timeout":
      return "The DNS lookup timed out. Try again in a moment.";
    default:
      return "The DNS lookup failed. Try again in a moment.";
  }
}

async function reread(
  service: Awaited<ReturnType<typeof createServiceClient>>,
  id: string,
  orgId: string,
) {
  const { data } = await service
    .from("org_domains")
    .select(DOMAIN_ROW_COLUMNS)
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  return data ?? null;
}
