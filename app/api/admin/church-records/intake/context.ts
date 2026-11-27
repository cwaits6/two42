// Shared by the church admin's routes for sending new people.
import { NextResponse } from "next/server";
import { requireOrgAdmin } from "@/lib/members/access";
import { logError } from "@/lib/log";
import { RecordsError } from "@/lib/integrations/records/errors";
import { gateError, hidden, intakeFailureMessage, RECORDS_KEY_SHAPE, recordsSecretOrNull } from "@/lib/integrations/records/http";
import { loadIntakeCredentials } from "@/lib/integrations/records/intake";
import { providerFor } from "@/lib/integrations/records/providers";
import { loadCredentials, readConnection } from "@/lib/integrations/records/store";
import type { RecordsCredentials, RecordsIntake, RecordsProvider } from "@/lib/integrations/records/types";

export interface IntakeContext {
  orgId: string;
  userId: string;
  secret: Buffer;
  provider: RecordsProvider;
  intake: RecordsIntake;
  connectionId: string;
  baseUrl: string;
}

/**
 * The caller's church, once they are a church admin and its records' provider
 * can send new people; otherwise the answer to give. The org is the caller's
 * own, from requireOrgAdmin(), never the request.
 */
export async function intakeContext(): Promise<{ ok: true; ctx: IntakeContext } | { ok: false; response: Response }> {
  const secret = recordsSecretOrNull();
  if (!secret) return { ok: false, response: hidden() };
  const gate = await requireOrgAdmin();
  if (!gate.ok) return { ok: false, response: gateError(gate.status) };
  try {
    const connection = await readConnection(gate.orgId);
    const provider = connection && providerFor(connection.provider);
    const intake = provider?.intake;
    if (!connection || !provider || !intake) return { ok: false, response: hidden() };
    return {
      ok: true,
      ctx: {
        orgId: gate.orgId,
        userId: gate.user.id,
        secret,
        provider,
        intake,
        connectionId: connection.connectionId,
        baseUrl: connection.baseUrl,
      },
    };
  } catch (err) {
    logError("Church records new people connection read failed", err, { route: "/api/admin/church-records/intake", ids: { org: gate.orgId } });
    return { ok: false, response: serverError("Couldn't load sending new people.") };
  }
}

export function serverError(message: string) {
  return NextResponse.json({ error: message }, { status: 500 });
}

export function connectionChanged() {
  return NextResponse.json({ error: "The connection changed. Reload and try again." }, { status: 409 });
}

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

/**
 * The write key to use: the one in the body, or with none the saved one.
 * Refuses the read key, which never writes.
 */
export async function writeKey(ctx: IntakeContext, body: Record<string, unknown> | null): Promise<RecordsCredentials | Response> {
  const typed = typeof body?.key === "string" ? body.key.trim() : "";
  let key = typed;
  if (!typed) {
    const saved = await loadIntakeCredentials(ctx.orgId, ctx.secret);
    if (!saved) return badRequest(`Paste the ${ctx.intake.setup.keyLabel.toLowerCase()}.`);
    // The saved key belongs to the connection it was loaded with; never send it to another one's address.
    if (saved.connectionId !== ctx.connectionId) return connectionChanged();
    key = saved.creds.key;
  } else if (!RECORDS_KEY_SHAPE.test(typed)) {
    return badRequest(`Paste the ${ctx.intake.setup.keyLabel.toLowerCase()} from ${ctx.provider.label}, with no spaces.`);
  }
  const read = await loadCredentials(ctx.orgId, ctx.secret);
  if (read?.creds.key === key) {
    return badRequest("Use a separate key for sending new people, not the key two42 reads with.");
  }
  return { baseUrl: ctx.baseUrl, key };
}

/** A refusal from the provider, as a message for the church admin. */
export function providerRefusal(ctx: IntakeContext, err: unknown): Response | null {
  if (!(err instanceof RecordsError)) return null;
  return badRequest(intakeFailureMessage(err, ctx.provider.label, ctx.intake.setup));
}
