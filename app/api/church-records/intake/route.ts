import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/log";
import { isMemberRole } from "@/lib/roles";
import { recordsSecretOrNull } from "@/lib/integrations/records/http";
import { acceptConsent, sendNewPerson, withdrawConsent } from "@/lib/integrations/records/intake";

export const dynamic = "force-dynamic";


/**
 * POST /api/church-records/intake — `{ share: boolean }`, from profile setup
 * once the person's profile is saved. `share: true` sends them to their
 * church's records once, after the response, so a slow or refusing records
 * system never holds up setup; `share: false` withdraws a consent given at
 * sign-up, and answers 409 when a send was already claimed, since that send
 * can't be stopped. Sends nothing while the church has sending off, or for a
 * person who is linked or was already sent.
 *
 * The org is the caller's own profile, and everything sent is read from that
 * row and the sign-in address, never from the body.
 */
export async function POST(request: Request) {
  const secret = recordsSecretOrNull();
  if (!secret) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (typeof body?.share !== "boolean") return NextResponse.json({ error: "Bad request" }, { status: 400 });

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("org_id, role, first_name, last_name, phone_mobile, phone_home")
    .eq("id", user.id)
    .single();
  if (error) {
    logError("Church records new person profile read failed", error, { route: "/api/church-records/intake", ids: { user: user.id } });
    return NextResponse.json({ error: "Couldn't save your choice." }, { status: 500 });
  }
  if (!isMemberRole(profile.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const orgId = profile.org_id;

  if (!body.share) {
    try {
      if ((await withdrawConsent(orgId, user.id)) === "too_late") {
        return NextResponse.json({ error: "Your details were already sent to the church office.", alreadySent: true }, { status: 409 });
      }
      return NextResponse.json({ ok: true });
    } catch (err) {
      logError("Church records consent withdraw failed", err, { route: "/api/church-records/intake", ids: { org: orgId, user: user.id } });
      return NextResponse.json({ error: "Couldn't save your choice." }, { status: 500 });
    }
  }

  const firstName = profile.first_name?.trim() ?? "";
  const lastName = profile.last_name?.trim() ?? "";
  if (!user.email || !firstName || !lastName) return NextResponse.json({ ok: true });
  const person = {
    firstName,
    lastName,
    email: user.email,
    phone: profile.phone_mobile || profile.phone_home || null,
  };
  let acceptId: string | null;
  try {
    acceptId = await acceptConsent(orgId, user.id);
  } catch (err) {
    logError("Church records consent accept failed", err, { route: "/api/church-records/intake", ids: { org: orgId, user: user.id } });
    return NextResponse.json({ error: "Couldn't save your choice." }, { status: 500 });
  }
  if (!acceptId) return NextResponse.json({ ok: true });
  const accepted = acceptId;
  after(() => sendNewPerson(orgId, user.id, accepted, person, secret));
  return NextResponse.json({ ok: true }, { status: 202 });
}
