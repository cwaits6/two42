import { NextResponse } from "next/server";
import { logError } from "@/lib/log";
import { sealKey } from "@/lib/integrations/records/crypto";
import { intakeFailureMessage } from "@/lib/integrations/records/http";
import {
  deleteIntakeSettings,
  intakeKeyLabel,
  readIntakeSettings,
  readIntakeStatus,
  saveIntakeSettings,
} from "@/lib/integrations/records/intake";
import { RecordsError } from "@/lib/integrations/records/errors";
import { badRequest, type IntakeContext, intakeContext, providerRefusal, serverError, writeKey } from "./context";

/**
 * /api/admin/church-records/intake — sending people who join two42 to the
 * church's records, for its staff to review. Off until a church admin turns
 * it on here with a write key of its own.
 *
 *   GET     `{ intake: null }` while off, or the setting as an admin may see
 *           it: the write key's last characters, where new people go, and how
 *           many were sent or couldn't be. Never the key.
 *   PUT     `{ key?, destinationId }` turns it on, or changes the key or the
 *           destination. The key may be left out to keep the saved one; the
 *           read key is refused. The destination and the key's permission are
 *           checked with the provider before anything is saved.
 *   DELETE  turns it off: removes the write key and every consent not yet sent.
 *
 * Answers 404 while the church isn't connected, or its provider can't send new
 * people. The org is the caller's own, from requireOrgAdmin().
 */

export interface IntakeAnswer {
  keyHint: string;
  destination: { id: string; name: string };
  enabledAt: string;
  sent: number;
  failed: number;
  /** Why the newest send failed, for the church admin, when it did. */
  lastFailure: string | null;
}

async function answer(ctx: IntakeContext): Promise<IntakeAnswer | null> {
  const settings = await readIntakeSettings(ctx.orgId);
  if (!settings || settings.connectionId !== ctx.connectionId) return null;
  const status = await readIntakeStatus(ctx.orgId, settings.enabledAt);
  return {
    keyHint: settings.keyHint,
    destination: { id: settings.destinationId, name: settings.destinationName },
    enabledAt: settings.enabledAt,
    sent: status.sent,
    failed: status.failed,
    lastFailure: status.lastFailure
      ? intakeFailureMessage(new RecordsError(status.lastFailure), ctx.provider.label, ctx.intake.setup)
      : null,
  };
}

export async function GET() {
  const context = await intakeContext();
  if (!context.ok) return context.response;
  const { ctx } = context;
  try {
    return NextResponse.json({ intake: await answer(ctx) });
  } catch (err) {
    logError("Church records new people read failed", err, { route: "/api/admin/church-records/intake", ids: { org: ctx.orgId } });
    return serverError("Couldn't load sending new people.");
  }
}

export async function PUT(request: Request) {
  const context = await intakeContext();
  if (!context.ok) return context.response;
  const { ctx } = context;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const destinationId = ctx.intake.parseDestinationId(body?.destinationId);
  if (!destinationId) return badRequest(`Choose a ${ctx.intake.setup.destinationLabel}, or enter its id.`);

  let creds;
  try {
    creds = await writeKey(ctx, body);
  } catch (err) {
    logError("Church records write key read failed", err, { route: "/api/admin/church-records/intake", step: "key", ids: { org: ctx.orgId } });
    return serverError("Couldn't save sending new people.");
  }
  if (creds instanceof Response) return creds;

  let destination;
  try {
    destination = await ctx.intake.checkDestination(creds, destinationId);
  } catch (err) {
    const refusal = providerRefusal(ctx, err);
    if (refusal) return refusal;
    logError("Church records new people check threw", err, { route: "/api/admin/church-records/intake", step: "check", ids: { org: ctx.orgId } });
    return serverError("Couldn't check the write key. Try again.");
  }

  try {
    const saved = await saveIntakeSettings(ctx.orgId, {
      connectionId: ctx.connectionId,
      keyCiphertext: sealKey(ctx.secret, ctx.orgId, intakeKeyLabel(ctx.provider.id), creds.key),
      keyHint: creds.key.slice(-4),
      destinationId: destination.id,
      destinationName: destination.name,
      enabledBy: ctx.userId,
    });
    if (saved === "connection_changed") {
      return NextResponse.json({ error: "The connection changed. Reload and try again." }, { status: 409 });
    }
    return NextResponse.json({ intake: await answer(ctx) });
  } catch (err) {
    logError("Church records new people save failed", err, { route: "/api/admin/church-records/intake", step: "save", ids: { org: ctx.orgId } });
    return serverError("Couldn't save sending new people.");
  }
}

export async function DELETE() {
  const context = await intakeContext();
  if (!context.ok) return context.response;
  const { ctx } = context;
  try {
    await deleteIntakeSettings(ctx.orgId);
    return NextResponse.json({ intake: null });
  } catch (err) {
    logError("Church records new people turn off failed", err, { route: "/api/admin/church-records/intake", ids: { org: ctx.orgId } });
    return serverError("Couldn't turn off sending new people.");
  }
}
