import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { requireOrgAdmin } from "@/lib/members/access";
import { logError } from "@/lib/log";
import { RecordsCryptoError } from "@/lib/integrations/records/crypto";
import { RecordsError } from "@/lib/integrations/records/errors";
import { gateError, hidden, recordsFailure, recordsSecretOrNull } from "@/lib/integrations/records/http";
import { compare, suggest, type ProfileForMatch } from "@/lib/integrations/records/match";
import { insertLinks, loadCredentials, readLinks } from "@/lib/integrations/records/store";
import type { RecordsCredentials, RecordsProvider } from "@/lib/integrations/records/types";

/**
 * /api/admin/church-records/links — which two42 profiles are which people in
 * the church's records.
 *
 *   GET   the profiles already linked, and suggested people for the rest. A
 *         suggestion carries only the person's id and name and which facts
 *         agreed, never the records' values: matching is not a way to browse
 *         the records.
 *   POST  confirm links. Every pair is checked again against the records
 *         here, so a link the browser sends is made only if the names agree
 *         and the birthdays don't disagree. Confirming more than one at a
 *         time also needs an email or birthday to agree for each.
 *
 * Profiles and their addresses are read on the admin's own request client,
 * so RLS decides who is in the church; the records are read with the church's key.
 */

const MAX_CONFIRM = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The same shape the database allows for external_person_id.
const PERSON_ID = /^[A-Za-z0-9_-]{1,64}$/;

type Client = SupabaseClient<Database>;

interface ChurchProfile extends ProfileForMatch {
  name: string;
}

async function churchProfiles(supabase: Client, orgId: string): Promise<ChurchProfile[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, first_name, preferred_name, last_name, birth_month, birth_day, birth_year")
    .eq("org_id", orgId)
    .neq("role", "pending");
  if (error) throw error;
  const { data: emails, error: emailError } = await supabase.rpc("admin_member_emails");
  if (emailError) throw emailError;
  const emailOf = new Map((emails ?? []).map((row) => [row.profile_id, row.email]));
  return (data ?? []).map((row) => ({
    id: row.id,
    firstName: row.first_name,
    preferredName: row.preferred_name,
    lastName: row.last_name,
    email: emailOf.get(row.id) ?? null,
    birthMonth: row.birth_month,
    birthDay: row.birth_day,
    birthYear: row.birth_year,
    name: [row.preferred_name || row.first_name, row.last_name].filter(Boolean).join(" ") || "Unnamed person",
  }));
}

type Loaded =
  | { ok: true; provider: RecordsProvider; creds: RecordsCredentials }
  | { ok: false; response: NextResponse };

async function credentials(orgId: string, secret: Buffer): Promise<Loaded> {
  try {
    const loaded = await loadCredentials(orgId, secret);
    if (loaded) return { ok: true, ...loaded };
    return { ok: false, response: NextResponse.json({ error: "Connect your church's records first." }, { status: 409 }) };
  } catch (err) {
    // A key that won't open means RECORDS_KEY_SECRET changed since it was saved.
    const step = err instanceof RecordsCryptoError ? "open_key" : "read_connection";
    logError("Church records credentials unavailable", err, {
      route: "/api/admin/church-records/links",
      step,
      ids: { org: orgId },
    });
    const error =
      err instanceof RecordsCryptoError
        ? "The saved key can't be used any more. Connect your church's records again."
        : "Couldn't load the connection.";
    return { ok: false, response: NextResponse.json({ error }, { status: 500 }) };
  }
}

export async function GET() {
  const secret = recordsSecretOrNull();
  if (!secret) return hidden();
  const gate = await requireOrgAdmin();
  if (!gate.ok) return gateError(gate.status);
  const { orgId, supabase } = gate;
  const loaded = await credentials(orgId, secret);
  if (!loaded.ok) return loaded.response;
  const { provider, creds } = loaded;

  let profiles: ChurchProfile[];
  let links: Awaited<ReturnType<typeof readLinks>>;
  try {
    [profiles, links] = await Promise.all([churchProfiles(supabase, orgId), readLinks(orgId)]);
  } catch (err) {
    logError("Church records link list read failed", err, {
      route: "/api/admin/church-records/links",
      step: "read",
      ids: { org: orgId },
    });
    return NextResponse.json({ error: "Couldn't load people." }, { status: 500 });
  }

  const nameOf = new Map(profiles.map((p) => [p.id, p.name]));
  const linkedIds = new Set(links.map((l) => l.profileId));
  const unlinked = profiles.filter((p) => !linkedIds.has(p.id));

  try {
    const people = await provider.findByLastNames(
      creds,
      unlinked.map((p) => p.lastName ?? ""),
    );
    const suggestions = suggest(unlinked, people, new Set(links.map((l) => l.personId)));
    const suggested = new Set(suggestions.map((s) => s.profileId));
    return NextResponse.json({
      linked: links
        .filter((l) => nameOf.has(l.profileId))
        .map((l) => ({ ...l, name: nameOf.get(l.profileId)!, personUrl: provider.personUrl(creds.baseUrl, l.personId) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      suggestions: suggestions.map((s) => ({ ...s, name: nameOf.get(s.profileId) })),
      unmatched: unlinked.filter((p) => !suggested.has(p.id)).length,
    });
  } catch (err) {
    if (err instanceof RecordsError) return recordsFailure(err, provider.label);
    logError("Church records suggestions failed", err, {
      route: "/api/admin/church-records/links",
      step: "suggest",
      ids: { org: orgId },
    });
    return NextResponse.json({ error: `Couldn't load suggestions from ${provider.label}.` }, { status: 500 });
  }
}

function parseLinks(body: unknown): { profileId: string; personId: string }[] | null {
  const list = (body as { links?: unknown } | null)?.links;
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_CONFIRM) return null;
  const parsed: { profileId: string; personId: string }[] = [];
  for (const item of list) {
    const { profileId, personId } = (item ?? {}) as Record<string, unknown>;
    if (typeof profileId !== "string" || !UUID.test(profileId)) return null;
    if (typeof personId !== "string" || !PERSON_ID.test(personId)) return null;
    parsed.push({ profileId, personId });
  }
  const profiles = new Set(parsed.map((l) => l.profileId));
  const people = new Set(parsed.map((l) => l.personId));
  if (profiles.size !== parsed.length || people.size !== parsed.length) return null;
  return parsed;
}

export async function POST(request: Request) {
  const secret = recordsSecretOrNull();
  if (!secret) return hidden();
  const gate = await requireOrgAdmin();
  if (!gate.ok) return gateError(gate.status);
  const { orgId, supabase, user } = gate;

  const links = parseLinks(await request.json().catch(() => null));
  if (!links) return NextResponse.json({ error: "Choose who to link." }, { status: 400 });
  const loaded = await credentials(orgId, secret);
  if (!loaded.ok) return loaded.response;
  const { provider, creds } = loaded;

  let profiles: ChurchProfile[];
  try {
    profiles = await churchProfiles(supabase, orgId);
  } catch (err) {
    logError("Church records link profiles read failed", err, {
      route: "/api/admin/church-records/links",
      step: "read",
      ids: { org: orgId },
    });
    return NextResponse.json({ error: "Couldn't load people." }, { status: 500 });
  }
  const profileById = new Map(profiles.map((p) => [p.id, p]));

  try {
    const people = new Map(
      (await provider.findByIds(creds, links.map((l) => l.personId))).map((p) => [p.id, p]),
    );
    for (const link of links) {
      const profile = profileById.get(link.profileId);
      const person = people.get(link.personId);
      const facts = profile && person?.linkable ? compare(profile, person) : null;
      const enough = facts && (links.length === 1 || facts.email || facts.birthday);
      if (!enough) {
        return NextResponse.json(
          { error: `One of these no longer matches its ${provider.label} record. Reload and check the suggestions.` },
          { status: 409 },
        );
      }
    }
  } catch (err) {
    if (err instanceof RecordsError) return recordsFailure(err, provider.label);
    logError("Church records link check failed", err, {
      route: "/api/admin/church-records/links",
      step: "check",
      ids: { org: orgId },
    });
    return NextResponse.json({ error: `Couldn't check these with ${provider.label}.` }, { status: 500 });
  }

  try {
    const result = await insertLinks(orgId, user.id, links);
    if (result === "conflict") {
      return NextResponse.json(
        { error: "Someone here is already linked. Reload to see the current links." },
        { status: 409 },
      );
    }
    return NextResponse.json({ linked: links.length });
  } catch (err) {
    logError("Church records link insert failed", err, {
      route: "/api/admin/church-records/links",
      step: "insert",
      ids: { org: orgId },
    });
    return NextResponse.json({ error: "Couldn't save the links." }, { status: 500 });
  }
}
