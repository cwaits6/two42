import { notFound } from "next/navigation";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { ErrorState } from "@/components/states/ErrorState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BringListDialog } from "@/components/supperClub/BringListDialog";
import { MoveSupperButton } from "@/components/supperClub/MoveSupperButton";
import { TablesEditor } from "@/components/supperClub/TablesEditor";
import { formatAddress } from "@/lib/supperClub/ics";
import { supperWhen, FORMAT_LABELS, partyName } from "@/lib/supperClub/labels";
import { cantHostSuppers } from "@/lib/supperClub/attention";
import { bringListFor } from "@/lib/supperClub/bringList";
import { pastPairsFromHistory } from "@/lib/supperClub/history";
import { supperKey, draftFromPublished, fitDraft, parseDraft, type Draft } from "@/lib/supperClub/shuffle";
import { groupPath, isUuid } from "@/lib/groups/active";
import { requireGroupLeader } from "@/lib/groups/server";
import { groupPageTitle } from "@/lib/pageTitle";
import { createClient } from "@/lib/supabase/server";
import { getOrgTimeZone } from "@/lib/time/orgZone";
import { loadPastTables, loadPeople, loadRotation, loadRotationData, peopleOf, shuffleParties } from "../../../load";

export const generateMetadata = groupPageTitle("Tables");

export default async function TablesPage({ params }: { params: Promise<{ groupId: string; rotationId: string }> }) {
  const { groupId, rotationId } = await params;
  const group = await requireGroupLeader(groupId);
  if (!isUuid(rotationId)) notFound();
  const supabase = await createClient();
  const read = await loadRotation(supabase, group.id, rotationId);
  if (!read) {
    return (
      <PageContainer>
        <PageHeader
          title="Tables"
          backHref={groupPath(group.id, `/supper-club/rotations/${rotationId}`)}
          backLabel="Back to the rotation"
        />
        <ErrorState thing="the tables" />
      </PageContainer>
    );
  }
  const { rotation } = read;
  if (!rotation || rotation.status === "draft") notFound();
  const zone = await getOrgTimeZone();
  const { format } = rotation;
  const published = rotation.status === "published" || rotation.status === "ended";
  const header = {
    title: `${rotation.title}: tables`,
    subtitle: FORMAT_LABELS[format],
    backHref: groupPath(group.id, `/supper-club/rotations/${rotation.id}`),
    backLabel: "Back to the rotation",
  };

  const [data, { data: stored, error: draftError }, pastTables] = await Promise.all([
    loadRotationData(supabase, rotation.id),
    supabase.from("supper_drafts").select("body").eq("rotation_id", rotation.id).maybeSingle(),
    loadPastTables(supabase, rotation),
  ]);
  const people = data ? await loadPeople(supabase, data.members.map((m) => m.profile_id)) : null;
  if (!data || !people || draftError || !pastTables) {
    return (
      <PageContainer>
        <PageHeader {...header} />
        <ErrorState thing="the tables" />
      </PageContainer>
    );
  }

  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  const names = Object.fromEntries(
    data.parties.map((p) => [p.id, partyName(peopleOf(data, p.id).map((id) => nameOf.get(id) ?? "Someone who left"))])
  );
  const dates = data.dates.map((d) => ({ value: d.id, label: supperWhen(d.starts_at, zone) }));
  const fromPublished = published
    ? draftFromPublished(
        data.tables.map((t) => ({
          id: t.id,
          rotationDateId: t.rotation_date_id,
          position: t.position,
          partyIds: data.seats.filter((s) => s.table_id === t.id && !s.left_at).map((s) => s.party_id),
          hosts: data.suppers
            .filter((d) => d.table_id === t.id)
            .map((d) => ({ rotationDateId: d.rotation_date_id, partyId: d.host_party_id })),
        })),
        format,
        data.dates.map((d) => d.id),
        0
      )
    : null;
  const saved = stored ? parseDraft(stored.body) : null;
  const shuffleable = shuffleParties(data);
  const fit = (draft: Draft | null) =>
    draft && fitDraft(draft, format, dates.map((d) => d.value), shuffleable.map((p) => p.id));
  const initialDraft = fit(saved) ?? fit(fromPublished);
  const addressOf = new Map(data.addresses.map((a) => [a.party_id, formatAddress(a)]));
  const now = new Date();
  const heldSuppers = data.suppers
    .filter((d) => new Date(d.starts_at) <= now)
    .map((d) => supperKey(d.table_id, d.rotation_date_id));
  const futureSuppers = data.suppers.filter((d) => new Date(d.starts_at) > now);
  const cantHost = cantHostSuppers(futureSuppers, data.parties);
  const cantHostIds = new Set(cantHost.map((d) => d.id));
  const pastPairs = pastPairsFromHistory(
    shuffleable.map((p) => ({ id: p.id, profileIds: peopleOf(data, p.id) })),
    pastTables
  );
  const firstNames = new Map(people.map((p) => [p.id, p.firstName]));
  const bringList = (d: (typeof data.suppers)[number]) => ({
    supper: { id: d.id, rotationId: rotation.id, groupId: group.id, tableId: d.table_id, label: supperWhen(d.starts_at, zone) },
    ...bringListFor(d, data, (partyId) =>
      partyName(peopleOf(data, partyId).map((id) => firstNames.get(id) ?? "Someone who left"))
    ),
  });

  // A date is still to come while any of its suppers is: a host may have
  // moved their table's supper past the date it was set on.
  const futureDateIds = data.dates
    .filter((sd) => {
      const onDate = data.suppers.filter((d) => d.rotation_date_id === sd.id);
      return onDate.length > 0 ? onDate.some((d) => new Date(d.starts_at) > now) : new Date(sd.starts_at) > now;
    })
    .map((sd) => sd.id);

  return (
    <PageContainer size="wide">
      <PageHeader {...header} />
      <div className="space-y-10">
        {rotation.status !== "ended" && (
          <TablesEditor
            // A publish that adds tables gives them new ids; remounting drops
            // the pre-publish draft, whose tables would publish as new again.
            key={data.tables.map((t) => t.id).join(",")}
            groupId={group.id}
            rotationId={rotation.id}
            format={format}
            published={published}
            dates={dates}
            tableSize={{ min: rotation.table_size_min, max: rotation.table_size_max }}
            allowBackToBack={rotation.allow_back_to_back_hosting}
            parties={shuffleable}
            names={names}
            initialDraft={initialDraft}
            heldSuppers={heldSuppers}
            futureDateIds={futureDateIds}
            cantHost={Object.fromEntries(
              cantHost.map((d) => [supperKey(d.table_id, d.rotation_date_id), d.host_party_id])
            )}
            pastPairs={pastPairs}
          />
        )}

        {published && (
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl font-bold">Published suppers</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y divide-border rounded-xl border border-border">
                {data.suppers.map((d) => {
                  const table = data.tables.find((t) => t.id === d.table_id);
                  return (
                    <li key={d.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="space-y-1">
                        <p className="text-lg font-semibold">
                          Table {table ? data.tables.filter((t) => t.rotation_date_id === table.rotation_date_id).indexOf(table) + 1 : ""}
                          {" · "}
                          {supperWhen(d.starts_at, zone)}
                        </p>
                        <p className="text-base text-muted-foreground">
                          {d.host_party_id ? `Host: ${names[d.host_party_id] ?? ""}` : "No host"}
                          {d.host_party_id && addressOf.get(d.host_party_id) ? ` · ${addressOf.get(d.host_party_id)}` : ""}
                        </p>
                        {cantHostIds.has(d.id) && (
                          <p className="text-base font-semibold text-destructive">Host can&apos;t host</p>
                        )}
                      </div>
                      {rotation.status === "published" && new Date(d.starts_at) > now && (
                        <div className="flex flex-col gap-3 sm:flex-row">
                          <MoveSupperButton supperId={d.id} startsAt={d.starts_at} zone={zone} />
                          {rotation.bring_list_enabled && <BringListDialog {...bringList(d)} />}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </PageContainer>
  );
}
