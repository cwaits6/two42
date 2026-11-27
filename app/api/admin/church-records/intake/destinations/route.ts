import { NextResponse } from "next/server";
import { logError } from "@/lib/log";
import type { RecordsIntakeDestination } from "@/lib/integrations/records/types";
import { intakeContext, providerRefusal, serverError, writeKey } from "../context";

/**
 * POST /api/admin/church-records/intake/destinations — `{ key?, connectionId }`: where in
 * the church's records new people can go, read through the write key in the
 * body, or with none the saved one, for the church admin to pick from. A POST
 * so the key never sits in an address.
 */

export type DestinationsAnswer = { destinations: RecordsIntakeDestination[] };

export async function POST(request: Request) {
  const context = await intakeContext();
  if (!context.ok) return context.response;
  const { ctx } = context;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  try {
    const creds = await writeKey(ctx, body);
    if (creds instanceof Response) return creds;
    return NextResponse.json<DestinationsAnswer>({ destinations: await ctx.intake.destinations(creds) });
  } catch (err) {
    const refusal = providerRefusal(ctx, err);
    if (refusal) return refusal;
    logError("Church records new people destinations read failed", err, { route: "/api/admin/church-records/intake/destinations", ids: { org: ctx.orgId } });
    return serverError(`Couldn't load the ${ctx.intake.setup.destinationLabel}s.`);
  }
}
