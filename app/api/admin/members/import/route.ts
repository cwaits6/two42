/**
 * POST /api/admin/members/import?mode=validate|apply (CWA-40).
 *
 * Accepts the export CSV shape back (multipart `file` field, or a raw
 * text/csv body), validates EVERY row before writing any of them, and — in
 * apply mode only — executes the planned writes through the cookie-bound
 * client. RLS is the tenant boundary: no insert payload ever carries org_id
 * (the column DEFAULT public.app_current_org_id() is the fail-closed
 * resolver), and a file containing an org_id column is a hard 400.
 *
 * The uploaded bytes live only in memory — never a temp file, never disk.
 * Response bodies legitimately contain member data (the admin already holds
 * the file); console.* must not — log line numbers, codes, and counts only.
 *
 * Atomicity (G7): PostgREST gives no cross-statement transaction. Validation
 * removes every predictable failure, but a concurrent edit between snapshot
 * and apply can still fail mid-run; the response then reports `applied` and
 * `failedAt` so the admin knows exactly where things stand. The follow-up
 * (member_import_runs + a SECURITY DEFINER apply RPC) is named in the PR.
 */
import crypto from "crypto";
import { NextResponse } from "next/server";
import { requireOrgAdmin } from "@/lib/members/access";
import { parseMembers } from "@/lib/members/format";
import { planImport, type PlannedWrite } from "@/lib/members/import-plan";
import { loadOrgSnapshot } from "@/lib/members/snapshot";
import type { OrgAdminGate } from "@/lib/members/access";

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_ROWS = 5000;

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

  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") ?? "validate";
  if (mode !== "validate" && mode !== "apply") {
    return json({ error: "mode must be validate or apply" }, 400);
  }

  // Read the body into a string IN MEMORY — never a temp path, never disk.
  let text: string;
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return json({ error: "Malformed multipart body" }, 400);
    }
    const file = form.get("file");
    if (!(file instanceof File)) {
      return json({ error: "Send the CSV as a `file` form field" }, 400);
    }
    if (file.size > MAX_BYTES) {
      return json({ error: "File too large", limit: MAX_BYTES }, 413);
    }
    text = await file.text();
  } else {
    text = await request.text();
    if (Buffer.byteLength(text, "utf8") > MAX_BYTES) {
      return json({ error: "File too large", limit: MAX_BYTES }, 413);
    }
  }

  const parsed = parseMembers(text);
  if (parsed.error) {
    return json(
      { error: parsed.error.message, code: parsed.error.code, warnings: parsed.warnings },
      400
    );
  }
  if (parsed.rows.length > MAX_ROWS) {
    return json(
      { error: "Too many rows", rowCount: parsed.rows.length, limit: MAX_ROWS },
      413
    );
  }

  let plan;
  try {
    const snapshot = await loadOrgSnapshot(gate.supabase);
    plan = planImport(parsed.rows, snapshot);
  } catch (err) {
    // err names a table only (see loadOrgSnapshot) — never row data.
    console.error("members import: snapshot load failed:", err);
    return json({ error: "Failed to load member data" }, 500);
  }

  // The brief's contract: validate every row before writing any of them.
  // One bad row means nothing applies, regardless of mode.
  if (plan.summary.error > 0) {
    return json(
      { mode, summary: plan.summary, rows: plan.rows, warnings: parsed.warnings },
      422
    );
  }

  if (mode === "validate") {
    return json(
      { mode, summary: plan.summary, rows: plan.rows, warnings: parsed.warnings },
      200
    );
  }

  const applyResult = await applyWrites(gate, plan.writes);
  if (!applyResult.ok) {
    return json(
      {
        error: "Import partially applied",
        applied: applyResult.applied,
        failedAt: applyResult.failedAt,
      },
      500
    );
  }

  return json(
    {
      mode,
      summary: plan.summary,
      applied: applyResult.applied,
      rows: plan.rows,
      warnings: parsed.warnings,
    },
    200
  );
}

type ApplyResult =
  | { ok: true; applied: number }
  | { ok: false; applied: number; failedAt: number };

/**
 * Reduce a write failure to the parts that are safe to log. A PostgrestError's
 * `details`/`hint` echo the offending row on a constraint violation — e.g.
 * `Key (email, org_id)=(ada@example.com, …) already exists` — which is member
 * PII. `code` and `message` name the constraint, not the values.
 */
function redactFailure(failure: unknown): string {
  if (failure && typeof failure === "object" && "code" in failure) {
    const e = failure as { code?: unknown; message?: unknown };
    return `code=${String(e.code ?? "unknown")} message=${String(e.message ?? "")}`;
  }
  return failure instanceof Error ? failure.message : "unknown error";
}

/**
 * Execute planned writes in dependency order. Inserts never include org_id —
 * the column DEFAULT resolves the caller's org — and household inserts feed
 * their new ids to the family_members inserts that reference them by the
 * per-file household key.
 */
async function applyWrites(
  gate: Extract<OrgAdminGate, { ok: true }>,
  writes: PlannedWrite[]
): Promise<ApplyResult> {
  const supabase = gate.supabase;
  const familyIdByKey = new Map<string, string>();
  let applied = 0;

  for (let i = 0; i < writes.length; i++) {
    const write = writes[i];
    let failure: unknown = null;

    switch (write.kind) {
      case "insert_family_unit": {
        const { data, error } = await supabase
          .from("family_units")
          .insert({ family_name: write.values.family_name })
          .select("id")
          .single();
        if (error || !data) {
          failure = error ?? new Error("insert returned no row");
          break;
        }
        familyIdByKey.set(write.householdKey, data.id);
        break;
      }
      case "insert_family_member": {
        const familyId =
          write.familyId ?? familyIdByKey.get(write.householdKey ?? "");
        if (!familyId) {
          failure = new Error("household key resolved no family id");
          break;
        }
        const { error } = await supabase
          .from("family_members")
          .insert({ ...write.values, family_id: familyId });
        failure = error;
        break;
      }
      case "update_family_member": {
        const { error } = await supabase
          .from("family_members")
          .update(write.values)
          .eq("id", write.id);
        failure = error;
        break;
      }
      case "update_profile": {
        const { error } = await supabase
          .from("profiles")
          .update(write.values)
          .eq("id", write.id);
        failure = error;
        break;
      }
      case "insert_access_request": {
        // Same shape invite-bulk creates, minus the email send (import must
        // not become a mass-mail primitive) and minus approved_role — left
        // NULL so handle_new_user() falls back to 'member'.
        const signupToken = crypto.randomBytes(32).toString("hex");
        const tokenExpiresAt = new Date(
          Date.now() + 14 * 24 * 60 * 60 * 1000
        ).toISOString();
        const { error } = await supabase.from("access_requests").insert({
          email: write.email,
          name: write.name,
          status: "approved",
          reviewed_by: gate.user.id,
          reviewed_at: new Date().toISOString(),
          signup_token: signupToken,
          token_expires_at: tokenExpiresAt,
        });
        failure = error;
        break;
      }
      case "insert_profile_group": {
        const { error } = await supabase.from("profile_groups").insert({
          profile_id: write.profileId,
          group_id: write.groupId,
          is_leader: write.isLeader,
          assigned_by: gate.user.id,
        });
        failure = error;
        break;
      }
      case "update_profile_group": {
        const { error } = await supabase
          .from("profile_groups")
          .update({ is_leader: write.isLeader })
          .eq("profile_id", write.profileId)
          .eq("group_id", write.groupId);
        failure = error;
        break;
      }
      case "delete_profile_group": {
        const { error } = await supabase
          .from("profile_groups")
          .delete()
          .eq("profile_id", write.profileId)
          .eq("group_id", write.groupId);
        failure = error;
        break;
      }
    }

    if (failure) {
      // Counts, positions, and the constraint identity only — a failed
      // write's payload (and the driver's echo of it) is member PII.
      console.error(
        "members import: apply failed at write %d/%d: %s",
        i + 1,
        writes.length,
        redactFailure(failure)
      );
      return { ok: false, applied, failedAt: i + 1 };
    }
    applied += 1;
  }

  return { ok: true, applied };
}
