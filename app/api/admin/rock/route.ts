import { NextResponse } from "next/server";
import { requireOrgAdmin } from "@/lib/members/access";
import { logError } from "@/lib/log";
import { parseRockAddress } from "@/lib/integrations/rock/address";
import { checkConnection, RockError } from "@/lib/integrations/rock/client";
import { sealRestKey } from "@/lib/integrations/rock/crypto";
import { gateError, hidden, rockFailure, rockSecretOrNull } from "@/lib/integrations/rock/http";
import { deleteConnection, readConnection, saveConnection } from "@/lib/integrations/rock/store";

/**
 * /api/admin/rock — the church's connection to its Rock RMS.
 *
 *   GET     the connection as an admin may see it: address, the key's last
 *           characters and when it was connected. Never the key.
 *   PUT     connect, or replace the address or key. The key is tried against
 *           Rock before it is saved, then sealed; a new address removes the
 *           links made against the old one.
 *   DELETE  disconnect: removes the key and every link. Profiles keep
 *           everything they hold.
 *
 * The org is the caller's own, from requireOrgAdmin(), never the request.
 */

// Rock generates 24-character keys; an admin can type their own.
const KEY_SHAPE = /^[\x21-\x7e]{8,200}$/;

export async function GET() {
  if (!rockSecretOrNull()) return hidden();
  const gate = await requireOrgAdmin();
  if (!gate.ok) return gateError(gate.status);
  try {
    return NextResponse.json({ connection: await readConnection(gate.orgId) });
  } catch (err) {
    logError("Rock connection read failed", err, { route: "/api/admin/rock", ids: { org: gate.orgId } });
    return NextResponse.json({ error: "Couldn't load the Rock connection." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const secret = rockSecretOrNull();
  if (!secret) return hidden();
  const gate = await requireOrgAdmin();
  if (!gate.ok) return gateError(gate.status);
  const { orgId, user } = gate;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const address = parseRockAddress(typeof body?.address === "string" ? body.address : "");
  if (!address.ok) return NextResponse.json({ error: address.reason }, { status: 400 });
  const restKey = typeof body?.restKey === "string" ? body.restKey.trim() : "";
  if (!KEY_SHAPE.test(restKey)) {
    return NextResponse.json({ error: "Paste the REST key from Rock, with no spaces." }, { status: 400 });
  }

  const creds = { baseUrl: address.origin, restKey };
  try {
    await checkConnection(creds);
  } catch (err) {
    if (err instanceof RockError) return rockFailure(err, 400);
    logError("Rock connection check threw", err, { route: "/api/admin/rock", step: "check", ids: { org: orgId } });
    return NextResponse.json({ error: "Couldn't check the connection. Try again." }, { status: 500 });
  }

  try {
    await saveConnection(orgId, {
      baseUrl: address.origin,
      keyCiphertext: sealRestKey(secret, orgId, restKey),
      keyHint: restKey.slice(-4),
      connectedBy: user.id,
    });
    return NextResponse.json({ connection: await readConnection(orgId) });
  } catch (err) {
    logError("Rock connection save failed", err, { route: "/api/admin/rock", step: "save", ids: { org: orgId } });
    return NextResponse.json({ error: "Couldn't save the Rock connection." }, { status: 500 });
  }
}

export async function DELETE() {
  if (!rockSecretOrNull()) return hidden();
  const gate = await requireOrgAdmin();
  if (!gate.ok) return gateError(gate.status);
  try {
    await deleteConnection(gate.orgId);
    return NextResponse.json({ connection: null });
  } catch (err) {
    logError("Rock disconnect failed", err, { route: "/api/admin/rock", ids: { org: gate.orgId } });
    return NextResponse.json({ error: "Couldn't disconnect Rock." }, { status: 500 });
  }
}
