import { notFound } from "next/navigation";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { ErrorState } from "@/components/states/ErrorState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MoveDinnerButton } from "@/components/dinnerClub/MoveDinnerButton";
import { TablesEditor } from "@/components/dinnerClub/TablesEditor";
import { formatAddress } from "@/lib/dinnerClub/ics";
import { dinnerWhen, FORMAT_LABELS, partyName } from "@/lib/dinnerClub/labels";
import { dinnerKey, draftFromPublished, fitDraft, parseDraft, type Draft } from "@/lib/dinnerClub/shuffle";
import { groupPath, isUuid } from "@/lib/groups/active";
import { requireGroupLeader } from "@/lib/groups/server";
import { groupPageTitle } from "@/lib/pageTitle";
import { createClient } from "@/lib/supabase/server";
import { getOrgTimeZone } from "@/lib/time/orgZone";
import { loadPeople, loadSeason, loadSeasonData, peopleOf, shuffleParties } from "../../../load";

export const generateMetadata = groupPageTitle("Tables");

export default async function TablesPage({ params }: { params: Promise<{ groupId: string; seasonId: string }> }) {
  const { groupId, seasonId } = await params;
  const group = await requireGroupLeader(groupId);
  if (!isUuid(seasonId)) notFound();
  const supabase = await createClient();
  const read = await loadSeason(supabase, group.id, seasonId);
  if (!read) {
    return (
      <PageContainer>
        <PageHeader
          title="Tables"
          backHref={groupPath(group.id, `/dinner-club/seasons/${seasonId}`)}
          backLabel="Back to the season"
        />
        <ErrorState thing="the tables" />
      </PageContainer>
    );
  }
  const { season } = read;
  if (!season || season.status === "draft") notFound();
  const zone = await getOrgTimeZone();
  const { format } = season;
  const published = season.status === "published" || season.status === "ended";
  const header = {
    title: `${season.title}: tables`,
    subtitle: FORMAT_LABELS[format],
    backHref: groupPath(group.id, `/dinner-club/seasons/${season.id}`),
    backLabel: "Back to the season",
  };

  const [data, { data: stored, error: draftError }] = await Promise.all([
    loadSeasonData(supabase, season.id),
    supabase.from("dinner_drafts").select("body").eq("season_id", season.id).maybeSingle(),
  ]);
  const people = data ? await loadPeople(supabase, data.members.map((m) => m.profile_id)) : null;
  if (!data || !people || draftError) {
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
  const dates = data.dates.map((d) => ({ value: d.id, label: dinnerWhen(d.starts_at, zone) }));
  const fromPublished = published
    ? draftFromPublished(
        data.tables.map((t) => ({
          id: t.id,
          seasonDateId: t.season_date_id,
          position: t.position,
          partyIds: data.seats.filter((s) => s.table_id === t.id && !s.left_at).map((s) => s.party_id),
          hosts: data.dinners
            .filter((d) => d.table_id === t.id)
            .map((d) => ({ seasonDateId: d.season_date_id, partyId: d.host_party_id })),
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
  const heldDinners = data.dinners
    .filter((d) => new Date(d.starts_at) <= now)
    .map((d) => dinnerKey(d.table_id, d.season_date_id));

  return (
    <PageContainer size="wide">
      <PageHeader {...header} />
      <div className="space-y-10">
        {season.status !== "ended" && (
          <TablesEditor
            // A publish that adds tables gives them new ids; remounting drops
            // the pre-publish draft, whose tables would publish as new again.
            key={data.tables.map((t) => t.id).join(",")}
            groupId={group.id}
            seasonId={season.id}
            format={format}
            published={published}
            dates={dates}
            tableSize={{ min: season.table_size_min, max: season.table_size_max }}
            allowBackToBack={season.allow_back_to_back_hosting}
            parties={shuffleable}
            names={names}
            initialDraft={initialDraft}
            heldDinners={heldDinners}
          />
        )}

        {published && (
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl font-bold">Published dinners</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y divide-border rounded-xl border border-border">
                {data.dinners.map((d) => {
                  const table = data.tables.find((t) => t.id === d.table_id);
                  return (
                    <li key={d.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="space-y-1">
                        <p className="text-lg font-semibold">
                          Table {table ? data.tables.filter((t) => t.season_date_id === table.season_date_id).indexOf(table) + 1 : ""}
                          {" · "}
                          {dinnerWhen(d.starts_at, zone)}
                        </p>
                        <p className="text-base text-muted-foreground">
                          {d.host_party_id ? `Host: ${names[d.host_party_id] ?? ""}` : "No host"}
                          {d.host_party_id && addressOf.get(d.host_party_id) ? ` · ${addressOf.get(d.host_party_id)}` : ""}
                        </p>
                      </div>
                      {season.status === "published" && new Date(d.starts_at) > new Date() && (
                        <MoveDinnerButton dinnerId={d.id} startsAt={d.starts_at} zone={zone} />
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
