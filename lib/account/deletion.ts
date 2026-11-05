/**
 * The one path that deletes a person, whether they asked or a church admin did.
 * `orgId` must come from the caller's own RLS-scoped profile. The database side
 * is one transaction in delete_person(), including the login, so a refusal or a
 * failure leaves everything as it was. What can't join that transaction runs
 * after it commits, and can't turn a finished deletion back into a failure.
 */
import { after } from "next/server";
import { displayName } from "@/lib/names";
import { personName, personNameOrEmail } from "@/lib/serving/display";
import { notifyLeadersOfCancel } from "@/lib/serving/server";
import { removeAvatarObjects } from "@/lib/storageDelete";
import { createServiceClient } from "@/lib/supabase/server";
import type { DeletionSummary, DeletionViewer } from "./deletionCopy";
import { rowsOf } from "./rows";
import { logError } from "@/lib/log";

type ServiceClient = Awaited<ReturnType<typeof createServiceClient>>;

export type PersonDeletionResult =
  | { outcome: "deleted"; photosNotRemoved: number }
  | { outcome: "not_found" | "platform_operator" | "last_church_admin" | "failed" };

interface FundRow {
  name: string;
  group_id: string;
  co_steward_id: string | null;
  groups: { name: string } | null;
}

// The rule the giving_funds triggers apply when delete_person() removes the
// profile, read ahead of time for the confirmation.
async function loadFunds(service: ServiceClient, orgId: string, personId: string) {
  const funds = rowsOf<FundRow>(
    await service
      .from("giving_funds")
      .select("name, group_id, co_steward_id, groups(name)")
      .eq("org_id", orgId)
      .eq("steward_id", personId)
      .order("name"),
    "funds",
  );
  const seconds = [
    ...new Set(funds.flatMap((f) => (f.co_steward_id && f.co_steward_id !== personId ? f.co_steward_id : []))),
  ];
  if (seconds.length === 0) return { passedOn: [], needingRecipient: funds.map(namedFund) };

  const memberships = rowsOf<{ group_id: string; profile_id: string }>(
    await service
      .from("group_members")
      .select("group_id, profile_id")
      .eq("org_id", orgId)
      .in("profile_id", seconds),
    "second people's groups",
  );
  const people = rowsOf<{
    id: string;
    role: string;
    first_name: string | null;
    last_name: string | null;
    preferred_name: string | null;
  }>(
    await service
      .from("profiles")
      .select("id, role, first_name, last_name, preferred_name")
      .eq("org_id", orgId)
      .in("id", seconds),
    "second people",
  );
  const inGroup = new Set(memberships.map((m) => `${m.group_id}:${m.profile_id}`));
  const names = new Map(people.map((p) => [p.id, personName(p)]));
  const pending = new Set(people.filter((p) => p.role === "pending").map((p) => p.id));

  const passesOn = (f: FundRow) =>
    !!f.co_steward_id && !pending.has(f.co_steward_id) && inGroup.has(`${f.group_id}:${f.co_steward_id}`);
  return {
    passedOn: funds.filter(passesOn).map((f) => ({
      ...namedFund(f),
      recipient: names.get(f.co_steward_id ?? "") ?? "",
    })),
    needingRecipient: funds.filter((f) => !passesOn(f)).map(namedFund),
  };
}

function namedFund(fund: FundRow) {
  return { name: fund.name, group: fund.groups?.name ?? "" };
}

/**
 * What the confirmation names; null when the person isn't in this church. Fund
 * and group names are group content, which a church admin has no access to, so
 * they get only the counts.
 */
export async function loadDeletionSummary(
  orgId: string,
  personId: string,
  viewer: DeletionViewer,
): Promise<DeletionSummary | null> {
  const service = await createServiceClient();
  const [target] = rowsOf<{
    role: string;
    family_id: string | null;
    first_name: string | null;
    last_name: string | null;
    preferred_name: string | null;
    email: string | null;
  }>(
    await service
      .from("profiles")
      .select("role, family_id, first_name, last_name, preferred_name, email")
      .eq("id", personId)
      .eq("org_id", orgId),
    "target profile",
  );
  if (!target) return null;

  const operators = rowsOf<{ profile_id: string }>(
    // org-anchor: platform_admins has no org_id; personId was just read inside this org
    await service.from("platform_admins").select("profile_id").eq("profile_id", personId),
    "platform operator",
  );

  const otherAdmins =
    target.role === "admin"
      ? rowsOf<{ id: string }>(
          await service
            .from("profiles")
            .select("id")
            .eq("org_id", orgId)
            .eq("role", "admin")
            .neq("id", personId)
            .limit(1),
          "other church admins",
        )
      : [];

  const funds = await loadFunds(service, orgId, personId);

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
  const groupsLosingLeader = led
    .filter((g) => !stillLed.has(g.group_id))
    .map((g) => g.groups?.name ?? "");

  return {
    name: personNameOrEmail(target),
    lastChurchAdmin: target.role === "admin" && otherAdmins.length === 0,
    platformOperator: operators.length > 0,
    groupContent:
      viewer === "self"
        ? { kind: "names", fundsPassedOn: funds.passedOn, fundsNeedingRecipient: funds.needingRecipient, groupsLosingLeader }
        : {
            kind: "counts",
            fundsPassedOn: funds.passedOn.length,
            fundsNeedingRecipient: funds.needingRecipient.length,
            groupsLosingLeader: groupsLosingLeader.length,
          },
    household: target.family_id
      ? await loadHousehold(service, orgId, personId, target.family_id)
      : null,
  };
}

// The same household rule delete_person() applies.
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
  const entries = rowsOf<{
    first_name: string;
    last_name: string | null;
    preferred_name: string | null;
    claimed_profile_id: string | null;
  }>(
    await service
      .from("family_members")
      .select("first_name, last_name, preferred_name, claimed_profile_id")
      .eq("org_id", orgId)
      .eq("family_id", familyId),
    "household entries",
  );
  return {
    name: family.family_name,
    shared:
      otherProfiles.length > 0 ||
      entries.some((e) => e.claimed_profile_id && e.claimed_profile_id !== personId),
    entries: entries.filter((e) => e.claimed_profile_id !== personId).map((e) => displayName(e)),
  };
}

interface DeletedPerson {
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  photo_keys: string[];
  opened_dates: { team_id: string; group_id: string; team_name: string; service_date: string }[];
}

const REFUSALS: Record<string, "not_found" | "platform_operator" | "last_church_admin"> = {
  AD001: "not_found",
  AD002: "platform_operator",
  CA001: "last_church_admin",
};

async function tellLeadersDatesOpened(
  service: ServiceClient,
  orgId: string,
  person: DeletedPerson,
  actorId: string | undefined,
) {
  const teams = Map.groupBy(person.opened_dates, (date) => date.team_id);
  for (const [teamId, dates] of teams) {
    try {
      await notifyLeadersOfCancel(service, {
        groupId: dates[0].group_id,
        teamId,
        orgId,
        teamName: dates[0].team_name,
        serviceDates: dates.map((date) => date.service_date),
        memberLabel: personName(person),
        excludeProfileId: actorId,
      });
    } catch (err) {
      // The error's name only: a provider's message can echo a name or an address.
      logError("Serving cancel notices failed for team", err, { ids: { team: teamId } });
    }
  }
}

/** `actorId` is who to leave out of the team-lead notices, when someone else is acting. */
export async function deletePerson(
  orgId: string,
  personId: string,
  actorId?: string,
): Promise<PersonDeletionResult> {
  let service: ServiceClient;
  let person: DeletedPerson;
  try {
    service = await createServiceClient();
    const { data, error } = await service.rpc("delete_person", {
      _person_id: personId,
      _org_id: orgId,
    });
    if (error) {
      const refusal = REFUSALS[error.code];
      if (refusal) return { outcome: refusal };
      logError("Person deletion failed", error);
      return { outcome: "failed" };
    }
    person = data as unknown as DeletedPerson;
  } catch (err) {
    logError("Person deletion failed", err);
    return { outcome: "failed" };
  }

  const notRemoved = await removeAvatarObjects(orgId, person.photo_keys);
  // After the response, so a slow or dropped send can't report a committed delete as failed.
  if (person.opened_dates.length > 0) {
    after(() => tellLeadersDatesOpened(service, orgId, person, actorId));
  }
  return { outcome: "deleted", photosNotRemoved: notRemoved.length };
}

/** The answer both routes give for a result, so the two can't drift. */
export function deletionResponse(result: PersonDeletionResult): Response {
  switch (result.outcome) {
    case "deleted":
      return Response.json({ ok: true, photosNotRemoved: result.photosNotRemoved });
    case "not_found":
      return Response.json({ error: "Not found" }, { status: 404 });
    case "last_church_admin":
    case "platform_operator":
      return Response.json({ error: result.outcome }, { status: 409 });
    case "failed":
      return Response.json({ error: "Failed to delete" }, { status: 500 });
  }
}
