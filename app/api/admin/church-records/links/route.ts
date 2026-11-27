import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { requireOrgAdmin } from "@/lib/members/access";
import { logError } from "@/lib/log";
import { displayName, hasName } from "@/lib/names";
import { RecordsCryptoError, type RecordsSecrets } from "@/lib/integrations/records/crypto";
import { RecordsError } from "@/lib/integrations/records/errors";
import { gateError, hidden, recordsFailure, recordsSecretOrNull } from "@/lib/integrations/records/http";
import { compare, normalizeName, suggest, type ProfileForMatch, type Suggestion } from "@/lib/integrations/records/match";
import { insertLinks, loadCredentials, readLinks, type PersonLink } from "@/lib/integrations/records/store";
import type { RecordsCredentials, RecordsProvider } from "@/lib/integrations/records/types";

/**
 * /api/admin/church-records/links — which two42 profiles are which people in
 * the church's records.
 *
 *   GET   the profiles already linked, suggested people for the rest, and
 *         the profiles with no suggestion. A suggestion carries only the
 *         person's id, name and page address and which facts agreed, never
 *         the records' values: matching is not a way to browse the records.
 *   POST  confirm links. Every pair is checked again against the records
 *         here, so a link the browser sends is made only if the names agree
 *         and the birthdays don't disagree. Confirming more than one at a
 *         time needs each pair to be a suggestion that can be confirmed in
 *         bulk, worked out again here exactly as GET does, so a competing
 *         candidate the browser left out still blocks it.
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
    .select("id, first_name, preferred_name, last_name, suffix, birth_month, birth_day, birth_year")
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
    name: hasName(row) ? displayName(row) : "Unnamed person",
  }));
}

type Loaded =
  | { ok: true; provider: RecordsProvider; creds: RecordsCredentials; connectionId: string }
  | { ok: false; response: NextResponse };

async function credentials(orgId: string, secret: RecordsSecrets): Promise<Loaded> {
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
    const response =
      err instanceof RecordsCryptoError
        ? NextResponse.json(
            { error: "The saved key can't be opened. Choose Change key and enter it again; your links stay." },
            { status: 409 },
          )
        : NextResponse.json({ error: "Couldn't load the connection." }, { status: 500 });
    return { ok: false, response };
  }
}

interface Matching {
  profiles: ChurchProfile[];
  links: PersonLink[];
  unlinked: ChurchProfile[];
  suggestions: Suggestion[];
}

/**
 * Every suggestion for the church's unlinked profiles, from the records as
 * they are now. With `sameLastNameAs`, only profiles sharing a last name with
 * those profiles are considered. Every competitor for one of their pairs is
 * among them, since a suggestion needs the last names to agree, so their
 * pairs come out exactly as in the full list.
 */
async function matching(
  supabase: Client,
  orgId: string,
  provider: RecordsProvider,
  creds: RecordsCredentials,
  sameLastNameAs?: ReadonlySet<string>,
): Promise<Matching> {
  const [profiles, links] = await Promise.all([churchProfiles(supabase, orgId), readLinks(orgId)]);
  const linkedIds = new Set(links.map((l) => l.profileId));
  let unlinked = profiles.filter((p) => !linkedIds.has(p.id));
  if (sameLastNameAs) {
    const lastNames = new Set(
      profiles.filter((p) => sameLastNameAs.has(p.id)).map((p) => normalizeName(p.lastName)),
    );
    unlinked = unlinked.filter((p) => lastNames.has(normalizeName(p.lastName)));
  }
  const found = await provider.findByLastNames(
    creds,
    unlinked.map((p) => p.lastName ?? ""),
  );
  const suggestions = suggest(unlinked, found.people, new Set(links.map((l) => l.personId)), found.incompleteLastNames);
  return { profiles, links, unlinked, suggestions };
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

  let result: Matching;
  try {
    result = await matching(supabase, orgId, provider, creds);
  } catch (err) {
    if (err instanceof RecordsError) return recordsFailure(err, provider.label);
    logError("Church records suggestions failed", err, {
      route: "/api/admin/church-records/links",
      step: "suggest",
      ids: { org: orgId },
    });
    return NextResponse.json({ error: `Couldn't load suggestions from ${provider.label}.` }, { status: 500 });
  }

  const { profiles, links, unlinked, suggestions } = result;
  const nameOf = new Map(profiles.map((p) => [p.id, p.name]));
  const suggested = new Set(suggestions.map((s) => s.profileId));
  return NextResponse.json({
    linked: links
      .filter((l) => nameOf.has(l.profileId))
      .map((l) => ({ ...l, name: nameOf.get(l.profileId)!, personUrl: provider.personUrl(creds.baseUrl, l.personId) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    suggestions: suggestions.map((s) => ({
      ...s,
      name: nameOf.get(s.profileId),
      personUrl: provider.personUrl(creds.baseUrl, s.personId),
    })),
    // two42's own names for the people with no suggestion; nothing from the records.
    unmatched: unlinked
      .filter((p) => !suggested.has(p.id))
      .map((p) => ({ profileId: p.id, name: p.name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  });
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
  const { provider, creds, connectionId } = loaded;
  const noLongerMatches = NextResponse.json(
    { error: `One of these no longer matches its ${provider.label} record. Reload and check the suggestions.` },
    { status: 409 },
  );

  try {
    if (links.length === 1) {
      // One pair an admin confirmed by hand may be a name-only match.
      const [link] = links;
      const profile = (await churchProfiles(supabase, orgId)).find((p) => p.id === link.profileId);
      const [person] = await provider.findByIds(creds, [link.personId]);
      const facts = profile && person?.id === link.personId && person.linkable ? compare(profile, person) : null;
      if (!facts) return noLongerMatches;
    } else {
      const { suggestions } = await matching(supabase, orgId, provider, creds, new Set(links.map((l) => l.profileId)));
      const bulk = new Set(suggestions.filter((s) => s.confirmableInBulk).map((s) => `${s.profileId} ${s.personId}`));
      if (!links.every((l) => bulk.has(`${l.profileId} ${l.personId}`))) return noLongerMatches;
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
    const result = await insertLinks(orgId, connectionId, user.id, links);
    if (result === "connection_changed") {
      return NextResponse.json(
        { error: "The connection changed while you were linking. Reload and try again." },
        { status: 409 },
      );
    }
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
