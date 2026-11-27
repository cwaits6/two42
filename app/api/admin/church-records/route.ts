import { NextResponse } from "next/server";
import { requireOrgAdmin } from "@/lib/members/access";
import { logError } from "@/lib/log";
import { parseRecordsAddress } from "@/lib/integrations/records/address";
import { sealKey } from "@/lib/integrations/records/crypto";
import { RecordsError } from "@/lib/integrations/records/errors";
import { gateError, hidden, recordsFailure, recordsSecretOrNull } from "@/lib/integrations/records/http";
import { liveSourceOf, providerFor } from "@/lib/integrations/records/providers";
import { deleteConnection, readConnection, saveConnection } from "@/lib/integrations/records/store";

/**
 * /api/admin/church-records — the church's connection to its records, in
 * whichever church software keeps them.
 *
 *   GET     the connection as an admin may see it: the provider, address, the
 *           key's last characters and when it was connected. Never the key.
 *   PUT     connect, or replace the provider, address or key. The body names
 *           the provider; a missing or unknown one is refused. The key is
 *           tried against the provider before it is saved, then sealed; a new
 *           provider or address removes the links made against the old one.
 *   DELETE  disconnect: removes the key and every link. Profiles keep
 *           everything they hold.
 *
 * The org is the caller's own, from requireOrgAdmin(), never the request.
 */

// Rock generates 24-character keys; an admin can type their own.
const KEY_SHAPE = /^[\x21-\x7e]{8,200}$/;

function summary(connection: Awaited<ReturnType<typeof readConnection>>) {
  if (!connection) return null;
  const provider = providerFor(connection.provider);
  return {
    provider: connection.provider,
    baseUrl: connection.baseUrl,
    keyHint: connection.keyHint,
    connectedAt: connection.connectedAt,
    providerLabel: provider?.label ?? connection.provider,
    canCopy: !!provider?.copy,
    canSuggestHouseholds: !!provider?.copy?.households,
    canShowLive: liveSourceOf(provider) !== null,
  };
}

export async function GET() {
  if (!recordsSecretOrNull()) return hidden();
  const gate = await requireOrgAdmin();
  if (!gate.ok) return gateError(gate.status);
  try {
    return NextResponse.json({ connection: summary(await readConnection(gate.orgId)) });
  } catch (err) {
    logError("Church records connection read failed", err, { route: "/api/admin/church-records", ids: { org: gate.orgId } });
    return NextResponse.json({ error: "Couldn't load the connection." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const secret = recordsSecretOrNull();
  if (!secret) return hidden();
  const gate = await requireOrgAdmin();
  if (!gate.ok) return gateError(gate.status);
  const { orgId, user } = gate;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const provider = providerFor(body?.provider);
  if (!provider) return NextResponse.json({ error: "Choose which church software to connect." }, { status: 400 });
  const address = parseRecordsAddress(typeof body?.address === "string" ? body.address : "", provider.label);
  if (!address.ok) return NextResponse.json({ error: address.reason }, { status: 400 });
  const key = typeof body?.key === "string" ? body.key.trim() : "";
  if (!KEY_SHAPE.test(key)) {
    return NextResponse.json({ error: `Paste the key from ${provider.label}, with no spaces.` }, { status: 400 });
  }

  const creds = { baseUrl: address.origin, key };
  try {
    await provider.checkConnection(creds);
  } catch (err) {
    if (err instanceof RecordsError) return recordsFailure(err, provider.label, 400);
    logError("Church records connection check threw", err, {
      route: "/api/admin/church-records",
      step: "check",
      ids: { org: orgId },
    });
    return NextResponse.json({ error: "Couldn't check the connection. Try again." }, { status: 500 });
  }

  try {
    await saveConnection(orgId, {
      provider: provider.id,
      baseUrl: address.origin,
      keyCiphertext: sealKey(secret, orgId, provider.id, key),
      keyHint: key.slice(-4),
      connectedBy: user.id,
    });
    return NextResponse.json({ connection: summary(await readConnection(orgId)) });
  } catch (err) {
    logError("Church records connection save failed", err, {
      route: "/api/admin/church-records",
      step: "save",
      ids: { org: orgId },
    });
    return NextResponse.json({ error: "Couldn't save the connection." }, { status: 500 });
  }
}

export async function DELETE() {
  if (!recordsSecretOrNull()) return hidden();
  const gate = await requireOrgAdmin();
  if (!gate.ok) return gateError(gate.status);
  try {
    await deleteConnection(gate.orgId);
    return NextResponse.json({ connection: null });
  } catch (err) {
    logError("Church records disconnect failed", err, { route: "/api/admin/church-records", ids: { org: gate.orgId } });
    return NextResponse.json({ error: "Couldn't disconnect." }, { status: 500 });
  }
}
