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
import { parseDeletionOutcomes } from "./deletionOutcomes";
import { dataOf, rowsOf } from "./rows";
import { logError } from "@/lib/log";
import { hashedRequestsOf } from "@/lib/prayer/hashedRequests";
import { loadPrayerKeys } from "@/lib/prayer/keys";

type ServiceClient = Awaited<ReturnType<typeof createServiceClient>>;

export type PersonDeletionResult =
  | { outcome: "deleted"; photosNotRemoved: number }
  | { outcome: "not_found" | "platform_operator" | "last_church_admin" | "failed" };

async function loadOutcomes(service: ServiceClient, orgId: string, personId: string) {
  return parseDeletionOutcomes(
    dataOf<unknown>(
      await service.rpc("person_deletion_outcomes", { _person_id: personId, _org_id: orgId }),
      "deletion outcomes",
    ),
  );
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
    first_name: string | null;
    last_name: string | null;
    preferred_name: string | null;
    email: string | null;
  }>(
    await service
      .from("profiles")
      .select("role, first_name, last_name, preferred_name, email")
      .eq("id", personId)
      .eq("org_id", orgId),
    "target profile",
  );
  if (!target) return null;
  const outcomes = await loadOutcomes(service, orgId, personId);
  if (!outcomes) return null;

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

  const funds = {
    passedOn: outcomes.funds.flatMap((f) =>
      f.outcome === "passed_on" ? [{ name: f.name, group: f.group_name ?? "", recipient: personName(f.recipient) }] : [],
    ),
    needingRecipient: outcomes.funds.flatMap((f) =>
      f.outcome === "needs_recipient" ? [{ name: f.name, group: f.group_name ?? "" }] : [],
    ),
  };
  const household = outcomes.household;

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
    household: household && {
      name: household.name,
      shared: !household.goes,
      entries: household.entries.map((e) => displayName(e)),
    },
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
      // A provider's message can echo a name or an address.
      logError("Serving cancel notices failed for team", err, { ids: { team: teamId } });
    }
  }
}

/**
 * The ids of the person's hashed anonymous requests. Null when the keys are
 * missing or the read fails, so deletion refuses rather than leave them behind.
 * A hash under a wrong author key matches no one and cannot be told apart, so
 * under one the deletion goes ahead without them. A request they post between
 * this read and the commit stays until retention removes it, and they can no
 * longer sign in to post another.
 */
async function hashedRequestIds(service: ServiceClient, orgId: string, personId: string): Promise<string[] | null> {
  const keys = loadPrayerKeys();
  if (!keys) {
    logError("Prayer keys are not configured");
    return null;
  }
  const { data, error } = await hashedRequestsOf(service, orgId, personId, keys, "*");
  if (error) {
    logError("Failed to read anonymous prayer requests for a deletion", error);
    return null;
  }
  return data.map((row) => row.id);
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
    const requestIds = await hashedRequestIds(service, orgId, personId);
    if (!requestIds) return { outcome: "failed" };
    // Without hashed requests this is the two-argument call, which works
    // before and after the migration that adds the third.
    const { data, error } = await service.rpc("delete_person", {
      _person_id: personId,
      _org_id: orgId,
      ...(requestIds.length > 0 && { _anonymous_request_ids: requestIds }),
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
