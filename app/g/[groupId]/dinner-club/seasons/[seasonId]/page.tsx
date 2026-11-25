import { notFound } from "next/navigation";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { ErrorState } from "@/components/states/ErrorState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SeasonActions } from "@/components/dinnerClub/SeasonActions";
import { SeasonDates } from "@/components/dinnerClub/SeasonDates";
import { SignUpList, type SignUpRow } from "@/components/dinnerClub/SignUpList";
import { seasonDateStarts } from "@/lib/dinnerClub/dates";
import { formatAddress } from "@/lib/dinnerClub/ics";
import { FORMAT_LABELS, howOftenLabel, partyName, STATUS_LABELS } from "@/lib/dinnerClub/labels";
import { hostsNeeded, tooFewHosts } from "@/lib/dinnerClub/shuffle";
import { groupPath, isUuid } from "@/lib/groups/active";
import { requireGroupLeader } from "@/lib/groups/server";
import { groupPageTitle } from "@/lib/pageTitle";
import { createClient } from "@/lib/supabase/server";
import { getOrgTimeZone } from "@/lib/time/orgZone";
import { formatEventDate } from "@/lib/time/zone";
import { loadGroupPeople, loadSeason, loadSeasonData, peopleOf, shuffleParties } from "../../load";

export const generateMetadata = groupPageTitle("Season");

function day(date: string): string {
  return formatEventDate(`${date}T12:00:00Z`, "UTC");
}

export default async function SeasonPage({ params }: { params: Promise<{ groupId: string; seasonId: string }> }) {
  const { groupId, seasonId } = await params;
  const group = await requireGroupLeader(groupId);
  if (!isUuid(seasonId)) notFound();
  const supabase = await createClient();
  const read = await loadSeason(supabase, group.id, seasonId);
  const back = { backHref: groupPath(group.id, "/dinner-club"), backLabel: "Back to Dinner club" };
  if (!read) {
    return (
      <PageContainer>
        <PageHeader title="Season" {...back} />
        <ErrorState thing="this season" />
      </PageContainer>
    );
  }
  const { season } = read;
  if (!season) notFound();
  const zone = await getOrgTimeZone();
  const [data, people] = await Promise.all([loadSeasonData(supabase, season.id), loadGroupPeople(supabase, group.id)]);
  const { status, format } = season;

  if (!data || !people) {
    return (
      <PageContainer>
        <PageHeader title={season.title} {...back} />
        <ErrorState thing="this season" />
      </PageContainer>
    );
  }

  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  const signedUp = new Set(data.members.map((m) => m.profile_id));
  const rows: SignUpRow[] = data.parties.map((p) => {
    const address = data.addresses.find((a) => a.party_id === p.id);
    return {
      id: p.id,
      names: partyName(peopleOf(data, p.id).map((id) => nameOf.get(id) ?? "Someone who left the group")),
      people: peopleOf(data, p.id).length,
      canHost: p.can_host,
      seats: p.seats,
      status: p.status,
      address: p.can_host && address ? formatAddress(address) : null,
      foodNotes: data.notes.find((n) => n.party_id === p.id)?.food_notes ?? null,
    };
  });
  const parties = shuffleParties(data);
  const dateIds = data.dates.map((d) => d.id);
  const needed = hostsNeeded(
    parties.reduce((sum, p) => sum + p.size, 0),
    season.table_size_max
  );

  return (
    <PageContainer>
      <PageHeader
        title={season.title}
        subtitle={`${STATUS_LABELS[status]} · ${FORMAT_LABELS[format]}`}
        {...back}
      />
      <div className="space-y-8">
        <SeasonActions groupId={group.id} seasonId={season.id} status={status} />

        <Card>
          <CardHeader>
            <CardTitle className="text-2xl font-bold">About this season</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 text-lg sm:grid-cols-2">
              <div>
                <dt className="text-base text-muted-foreground">Runs</dt>
                <dd>
                  {day(season.starts_on)} to {day(season.ends_on)}
                </dd>
              </div>
              <div>
                <dt className="text-base text-muted-foreground">How often</dt>
                <dd>{howOftenLabel(season)}</dd>
              </div>
              <div>
                <dt className="text-base text-muted-foreground">Table size</dt>
                <dd>
                  {season.table_size_min} to {season.table_size_max} people
                </dd>
              </div>
              <div>
                <dt className="text-base text-muted-foreground">Sign-ups close</dt>
                <dd>{day(season.signup_closes_on)}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-2xl font-bold">Dates</CardTitle>
          </CardHeader>
          <CardContent>
            <SeasonDates
              groupId={group.id}
              seasonId={season.id}
              status={status}
              zone={zone}
              dates={data.dates.map((d) => ({ id: d.id, startsAt: d.starts_at }))}
              proposed={status === "draft" || status === "open" ? seasonDateStarts(season, zone) : []}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-2xl font-bold">Sign-ups</CardTitle>
          </CardHeader>
          <CardContent>
            <SignUpList
              seasonId={season.id}
              canChange={status === "open"}
              parties={rows}
              available={people.filter((p) => !signedUp.has(p.id)).map((p) => ({ id: p.id, name: p.name }))}
              hostsNeeded={needed}
              tooFewHosts={tooFewHosts(format, parties, dateIds, season.table_size_max)}
              perDinner={format === "new_tables"}
            />
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}
