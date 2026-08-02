/**
 * POST /api/admin/members/import?mode=validate|apply (CWA-40).
 *
 * Accepts the export CSV shape back (multipart `file` field, or a raw
 * text/csv body), validates EVERY row before writing any of them, and — in
 * apply mode only — executes the planned writes through the cookie-bound
 * client. Tenancy: a file containing an org_id column is a hard 400, and the
 * org the writes land in comes from gate.orgId — the caller's own RLS-scoped
 * profile row, never the request body. applyWrites() stamps that id on every
 * insert and filters every update/delete by it.
 *
 * The uploaded bytes live only in memory — never a temp file, never disk.
 * Response bodies legitimately contain member data (the admin already holds
 * the file); console.* must not — log line numbers, codes, and counts only.
 *
 * Atomicity (G7): PostgREST gives no cross-statement transaction. Validation
 * removes every predictable failure, but a concurrent edit between snapshot
 * and apply can still fail mid-run; the response then reports the CSV line
 * the run stopped on and the lines whose every write landed, so the admin
 * can delete those and safely re-upload the rest. That response is the ONLY
 * record of the event — member_import_runs (the audit table) is a named
 * follow-up alongside a SECURITY DEFINER apply RPC.
 */
import { NextResponse } from "next/server";
import { requireOrgAdmin } from "@/lib/members/access";
import { applyWrites } from "@/lib/members/apply";
import { parseMembers } from "@/lib/members/format";
import { planImport } from "@/lib/members/import-plan";
import { loadOrgSnapshot } from "@/lib/members/snapshot";

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_ROWS = 5000;

// Neither is a CORS "simple" content type, so a cross-origin POST to this
// state-changing route needs a preflight it will not survive. Deliberately
// excludes text/plain, which IS simple. Sibling routes get this free by
// parsing JSON; this one accepts a raw body, so it asks explicitly.
const CSV_CONTENT_TYPES = ["text/csv", "application/csv"];

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

  // Reject an oversized upload before buffering it, when the client declares
  // its size. The post-parse checks below stay as the backstop for a chunked
  // or lying Content-Length; true streaming is not worth the complexity on an
  // admin-only route.
  const declaredLength = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BYTES) {
    return json({ error: "File too large", limit: MAX_BYTES }, 413);
  }

  // Read the body into a string IN MEMORY — never a temp path, never disk.
  // Every read is guarded: a client disconnect mid-read would otherwise
  // escape to Next's default 500, which carries no Cache-Control: no-store
  // and logs nothing under this route's prefix.
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
    try {
      text = await file.text();
    } catch {
      return json({ error: "Could not read the uploaded file" }, 400);
    }
  } else {
    if (!CSV_CONTENT_TYPES.some((type) => contentType.includes(type))) {
      return json(
        {
          error:
            "Send the CSV as multipart/form-data, or as a raw body with Content-Type: text/csv",
        },
        415
      );
    }
    try {
      text = await request.text();
    } catch {
      return json({ error: "Could not read the request body" }, 400);
    }
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

  // Two try blocks, not one: err carries a table name only because
  // loadOrgSnapshot throws hand-written errors. Wrapping planImport in the
  // same block would log a planner crash as "snapshot load failed" — sending
  // whoever debugs it to the wrong module — with an unbounded message.
  let snapshot;
  try {
    snapshot = await loadOrgSnapshot(gate.supabase, gate.orgId);
  } catch (err) {
    console.error("members import: snapshot load failed:", err);
    return json({ error: "Failed to load member data" }, 500);
  }

  let plan;
  try {
    plan = planImport(parsed.rows, snapshot);
  } catch (err) {
    // The planner is pure and sees member data, so log the error TYPE only.
    console.error(
      "members import: planner threw:",
      err instanceof Error ? err.name : typeof err
    );
    return json({ error: "Failed to plan the import" }, 500);
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

  const applyResult = await applyWrites(
    gate.supabase,
    gate.user.id,
    gate.orgId,
    plan.writes
  );
  if (!applyResult.ok) {
    // Line numbers and write kinds are structural metadata, not member data —
    // exactly what the PII rule at the top of this file prescribes. Without
    // them `failedAt` is an index into a write list the client never sees.
    return json(
      {
        error: "Import partially applied",
        message:
          `The import stopped while writing line ${applyResult.failedAtLine}. ` +
          `Delete the lines listed in appliedLines from your file before ` +
          `re-uploading — re-importing them may create duplicate households.`,
        applied: applyResult.applied,
        failedAt: applyResult.failedAt,
        failedAtLine: applyResult.failedAtLine,
        failedKind: applyResult.failedKind,
        appliedLines: applyResult.appliedLines,
      },
      500
    );
  }

  return json(
    {
      mode,
      summary: plan.summary,
      applied: applyResult.applied,
      appliedLines: applyResult.appliedLines,
      rows: plan.rows,
      warnings: parsed.warnings,
    },
    200
  );
}

