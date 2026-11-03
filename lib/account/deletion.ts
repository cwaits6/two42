/**
 * The one path that deletes a person, whether they asked or a church admin
 * did. The service client is built here rather than passed in, and `orgId`
 * must come from the caller's own RLS-scoped profile: the target is looked up
 * inside that org before anything else, so someone from another church is
 * "not found" and auth.admin.deleteUser() is never reached for them.
 *
 * Deleting the login is last and the only step a retry can't come back from.
 * It cascades to the profile in one transaction, and through the profile to
 * everything the foreign keys cover. The steps before it each tolerate having
 * already run, so a failure anywhere leaves a person who can still sign in and
 * try again.
 */
import { displayName } from "@/lib/names";
import { relObjectPath } from "@/lib/storagePaths";
import { createServiceClient } from "@/lib/supabase/server";
import { deleteImage } from "@/lib/uploadImage";
import type { DeletionSummary } from "./deletionCopy";

type ServiceClient = Awaited<ReturnType<typeof createServiceClient>>;

export type PersonDeletionResult =
  | "deleted"
  | "not_found"
  | "last_church_admin"
  | "failed";

class DeletionStepFailed extends Error {
  constructor(step: string, code?: string) {
    // The step and code only: a PostgrestError's details echo row content.
    super(`${step}${code ? `: code=${code}` : ""}`);
  }
}

function rowsOf<T>(read: { data: unknown; error: { code?: string } | null }, step: string): T[] {
  if (read.error) throw new DeletionStepFailed(step, read.error.code);
  return (read.data ?? []) as T[];
}

// A filtered delete that matches nothing reports success, so the rows it
// returned are compared with the rows it was meant to remove.
async function deleteExactly(
  service: ServiceClient,
  table: string,
  orgId: string,
  ids: string[],
  step: string,
) {
  if (ids.length === 0) return;
  const removed = rowsOf<{ id: string }>(
    await service.from(table).delete().eq("org_id", orgId).in("id", ids).select("id"),
    step,
  );
  if (removed.length !== ids.length) throw new DeletionStepFailed(step);
}

async function isLastChurchAdmin(service: ServiceClient, orgId: string, personId: string) {
  const others = rowsOf<{ id: string }>(
    await service
      .from("profiles")
      .select("id")
      .eq("org_id", orgId)
      .eq("role", "admin")
      .neq("id", personId)
      .limit(1),
    "other church admins",
  );
  return others.length === 0;
}

interface TargetProfile {
  role: string;
  email: string | null;
  family_id: string | null;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
}

async function loadTarget(service: ServiceClient, orgId: string, personId: string) {
  const [target] = rowsOf<TargetProfile>(
    await service
      .from("profiles")
      .select("role, email, family_id, first_name, last_name, preferred_name")
      .eq("id", personId)
      .eq("org_id", orgId),
    "target profile",
  );
  return target ?? null;
}

interface HouseholdEntry {
  id: string;
  first_name: string;
  last_name: string | null;
  preferred_name: string | null;
  claimed_profile_id: string | null;
}

// A household belongs to everyone in it, so it goes only when no one else is
// left: no other profile points at it and no entry is claimed by someone else.
async function loadHousehold(
  service: ServiceClient,
  orgId: string,
  personId: string,
  familyId: string,
) {
  const [family] = rowsOf<{ family_name: string }>(
    await service.from("family_units").select("family_name").eq("id", familyId).eq("org_id", orgId),
    "household",
  );
  if (!family) return null;
  const otherProfiles = rowsOf<{ id: string }>(
    await service
      .from("profiles")
      .select("id")
      .eq("org_id", orgId)
      .eq("family_id", familyId)
      .neq("id", personId)
      .limit(1),
    "household profiles",
  );
  const entries = rowsOf<HouseholdEntry>(
    await service
      .from("family_members")
      .select("id, first_name, last_name, preferred_name, claimed_profile_id")
      .eq("org_id", orgId)
      .eq("family_id", familyId),
    "household entries",
  );
  const shared =
    otherProfiles.length > 0 ||
    entries.some((e) => e.claimed_profile_id && e.claimed_profile_id !== personId);
  return {
    name: family.family_name,
    shared,
    entries: entries.filter((e) => e.claimed_profile_id !== personId),
  };
}

/** What the confirmation names; null when the person isn't in this church. */
export async function loadDeletionSummary(
  orgId: string,
  personId: string,
): Promise<DeletionSummary | null> {
  const service = await createServiceClient();
  const target = await loadTarget(service, orgId, personId);
  if (!target) return null;

  const funds = rowsOf<{ name: string; groups: { name: string } | null }>(
    await service
      .from("giving_funds")
      .select("name, groups(name)")
      .eq("org_id", orgId)
      .eq("steward_id", personId)
      .order("name"),
    "funds",
  );

  const led = rowsOf<{ group_id: string; groups: { name: string } | null }>(
    await service
      .from("group_members")
      .select("group_id, groups(name)")
      .eq("org_id", orgId)
      .eq("profile_id", personId)
      .eq("role", "leader"),
    "groups led",
  );
  const otherLeaders =
    led.length === 0
      ? []
      : rowsOf<{ group_id: string }>(
          await service
            .from("group_members")
            .select("group_id")
            .eq("org_id", orgId)
            .eq("role", "leader")
            .neq("profile_id", personId)
            .in("group_id", led.map((g) => g.group_id)),
          "other leaders",
        );
  const stillLed = new Set(otherLeaders.map((l) => l.group_id));

  const household = target.family_id
    ? await loadHousehold(service, orgId, personId, target.family_id)
    : null;

  return {
    name: displayName(target),
    lastChurchAdmin: target.role === "admin" && (await isLastChurchAdmin(service, orgId, personId)),
    funds: funds.map((f) => ({ name: f.name, group: f.groups?.name ?? "" })),
    household: household && {
      name: household.name,
      shared: household.shared,
      entries: household.entries.map((e) => displayName(e)),
    },
    groupsLosingLeader: led
      .filter((g) => !stillLed.has(g.group_id))
      .map((g) => g.groups?.name ?? ""),
  };
}

// serving_signups.created_by cascades, so a date this person booked would
// disappear for whoever serves it with them unless it moves to them first. A
// date someone else booked for this person alone is left with nobody on it, so
// it opens back up.
async function settleServingDates(service: ServiceClient, orgId: string, personId: string) {
  const booked = rowsOf<{ id: string }>(
    await service
      .from("serving_signups")
      .select("id")
      .eq("org_id", orgId)
      .eq("created_by", personId),
    "booked serving dates",
  ).map((s) => s.id);
  const attending = rowsOf<{ signup_id: string }>(
    await service
      .from("serving_signup_attendees")
      .select("signup_id")
      .eq("org_id", orgId)
      .eq("profile_id", personId),
    "attended serving dates",
  ).map((a) => a.signup_id);

  const involved = [...new Set([...booked, ...attending])];
  if (involved.length === 0) return;

  const others = rowsOf<{ signup_id: string; profile_id: string }>(
    await service
      .from("serving_signup_attendees")
      .select("signup_id, profile_id")
      .eq("org_id", orgId)
      .in("signup_id", involved)
      .neq("profile_id", personId),
    "other attendees",
  );
  const remainingOn = new Map(others.map((a) => [a.signup_id, a.profile_id]));

  for (const signupId of booked) {
    const remaining = remainingOn.get(signupId);
    if (!remaining) continue;
    const moved = rowsOf<{ id: string }>(
      await service
        .from("serving_signups")
        .update({ created_by: remaining })
        .eq("id", signupId)
        .eq("org_id", orgId)
        .eq("created_by", personId)
        .select("id"),
      "move serving date",
    );
    if (moved.length !== 1) throw new DeletionStepFailed("move serving date");
  }

  const bookedSet = new Set(booked);
  await deleteExactly(
    service,
    "serving_signups",
    orgId,
    attending.filter((id) => !bookedSet.has(id) && !remainingOn.has(id)),
    "open serving date",
  );
}

// Neither table has a foreign key to the profile that would clear these, and an
// approved request left behind would let handle_new_user() sign this email
// straight back into the church.
async function deleteSignupRecords(
  service: ServiceClient,
  orgId: string,
  personId: string,
  email: string | null,
) {
  const pattern = email?.replace(/[\\%_]/g, "\\$&");
  if (pattern) {
    const requests = rowsOf<{ id: string }>(
      await service
        .from("access_requests")
        .select("id")
        .eq("org_id", orgId)
        .ilike("email", pattern),
      "access requests",
    );
    await deleteExactly(service, "access_requests", orgId, requests.map((r) => r.id), "delete access requests");
  }

  const byProfile = rowsOf<{ id: string }>(
    await service
      .from("group_invite_uses")
      .select("id")
      .eq("org_id", orgId)
      .eq("profile_id", personId),
    "invite uses",
  );
  const byEmail = pattern
    ? rowsOf<{ id: string }>(
        await service
          .from("group_invite_uses")
          .select("id")
          .eq("org_id", orgId)
          .ilike("email", pattern),
        "invite uses by email",
      )
    : [];
  await deleteExactly(
    service,
    "group_invite_uses",
    orgId,
    [...new Set([...byProfile, ...byEmail].map((u) => u.id))],
    "delete invite uses",
  );
}

// family_members.claimed_profile_id only clears on delete, which would leave
// this person listed in the household as someone who never signed up.
async function deleteHouseholdEntries(
  service: ServiceClient,
  orgId: string,
  personId: string,
  familyId: string | null,
) {
  const server = { client: service, orgId };

  const own = rowsOf<{ id: string }>(
    await service
      .from("family_members")
      .select("id")
      .eq("org_id", orgId)
      .eq("claimed_profile_id", personId),
    "own household entry",
  ).map((e) => e.id);
  for (const id of own) {
    await deleteImage("avatar", relObjectPath("family-members", id, "avatar"), server);
  }
  await deleteExactly(service, "family_members", orgId, own, "delete own household entry");

  if (!familyId) return;
  const household = await loadHousehold(service, orgId, personId, familyId);
  if (!household || household.shared) return;

  for (const entry of household.entries) {
    await deleteImage("avatar", relObjectPath("family-members", entry.id, "avatar"), server);
  }
  await deleteImage("family", relObjectPath("families", familyId, "photo"), server);
  await deleteExactly(service, "family_units", orgId, [familyId], "delete household");
}

export async function deletePerson(
  orgId: string,
  personId: string,
): Promise<PersonDeletionResult> {
  try {
    const service = await createServiceClient();

    const target = await loadTarget(service, orgId, personId);
    if (!target) return "not_found";
    if (target.role === "admin" && (await isLastChurchAdmin(service, orgId, personId))) {
      return "last_church_admin";
    }

    await settleServingDates(service, orgId, personId);
    await deleteSignupRecords(service, orgId, personId, target.email);
    await deleteHouseholdEntries(service, orgId, personId, target.family_id);
    await deleteImage("avatar", relObjectPath("profiles", personId, "avatar"), {
      client: service,
      orgId,
    });

    const { error } = await service.auth.admin.deleteUser(personId);
    if (error) {
      // The database rule is what decides, and it reaches here as Auth's generic
      // error when another admin was removed since the check above.
      if (target.role === "admin" && (await isLastChurchAdmin(service, orgId, personId))) {
        return "last_church_admin";
      }
      throw new DeletionStepFailed("delete login", error.code);
    }

    const left = rowsOf<{ id: string }>(
      await service.from("profiles").select("id").eq("id", personId).eq("org_id", orgId),
      "confirm profile gone",
    );
    if (left.length > 0) throw new DeletionStepFailed("confirm profile gone");
    return "deleted";
  } catch (err) {
    console.error("Person deletion failed:", err instanceof Error ? err.message : typeof err);
    return "failed";
  }
}

/** The answer both routes give for a result, so the two can't drift. */
export function deletionResponse(result: PersonDeletionResult): Response {
  switch (result) {
    case "deleted":
      return Response.json({ ok: true });
    case "not_found":
      return Response.json({ error: "Not found" }, { status: 404 });
    case "last_church_admin":
      return Response.json({ error: "last_church_admin" }, { status: 409 });
    case "failed":
      return Response.json({ error: "Failed to delete" }, { status: 500 });
  }
}
