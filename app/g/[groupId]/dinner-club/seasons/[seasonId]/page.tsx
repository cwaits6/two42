import Link from "next/link";
import { notFound } from "next/navigation";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { ErrorState } from "@/components/states/ErrorState";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SeasonActions } from "@/components/dinnerClub/SeasonActions";
import { SeasonDates } from "@/components/dinnerClub/SeasonDates";
import { SignUpList, type SignUpRow } from "@/components/dinnerClub/SignUpList";
import { seasonAttention } from "@/lib/dinnerClub/attention";
import { seasonDateStarts } from "@/lib/dinnerClub/dates";
import { formatAddress } from "@/lib/dinnerClub/ics";
import { dinnerWhen, FORMAT_LABELS, howOftenLabel, partyName, STATUS_LABELS } from "@/lib/dinnerClub/labels";
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

  const attention = seasonAttention({
    status,
    format,
    parties: data.parties,
    shuffleParties: parties,
    tables: data.tables,
    seats: data.seats,
    dinners: data.dinners,
    dateIds,
    tableSizeMax: season.table_size_max,
    now: new Date(),
  });
  const namesOf = new Map(rows.map((r) => [r.id, r.names]));
  const tableNumber = (tableId: string) => {
    const table = data.tables.find((t) => t.id === tableId);
    return table ? data.tables.filter((t) => t.season_date_id === table.season_date_id).indexOf(table) + 1 : 0;
  };
  const tableName = (tableId: string) => {
    const dateId = data.tables.find((t) => t.id === tableId)?.season_date_id;
    const date = dateId ? data.dates.find((d) => d.id === dateId) : undefined;
    return `Table ${tableNumber(tableId)}${date ? `, ${dinnerWhen(date.starts_at, zone)}` : ""}`;
  };
  const dinnerLine = (dinnerId: string) => {
    const d = data.dinners.find((x) => x.id === dinnerId);
    if (!d) return "";
    const host = d.host_party_id ? (namesOf.get(d.host_party_id) ?? "") : "No host";
    return `Table ${tableNumber(d.table_id)} · ${dinnerWhen(d.starts_at, zone)} · ${host}`;
  };
  const needsAttention =
    attention.cantHost.length + attention.hostLeft.length + attention.waiting.length > 0;

  return (
    <PageContainer>
      <PageHeader
        title={season.title}
        subtitle={`${STATUS_LABELS[status]} · ${FORMAT_LABELS[format]}`}
        {...back}
      />
      <div className="space-y-8">
        <SeasonActions groupId={group.id} seasonId={season.id} status={status} />

        {needsAttention && (
          <Card className="border-brand-primary/40">
            <CardHeader>
              <CardTitle className="text-2xl font-bold">Needs attention</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5 text-lg">
              {attention.cantHost.length > 0 && (
                <div className="space-y-1">
                  <p className="font-semibold">Host can&apos;t host</p>
                  <ul className="space-y-1">
                    {attention.cantHost.map((id) => (
                      <li key={id}>{dinnerLine(id)}</li>
                    ))}
                  </ul>
                </div>
              )}
              {attention.hostLeft.length > 0 && (
                <div className="space-y-1">
                  <p className="font-semibold">Host withdrew</p>
                  <ul className="space-y-1">
                    {attention.hostLeft.map((id) => (
                      <li key={id}>{dinnerLine(id)}</li>
                    ))}
                  </ul>
                </div>
              )}
              {attention.waiting.length > 0 && (
                <div className="space-y-1">
                  <p className="font-semibold">Waiting for a table</p>
                  <p>{attention.waiting.map((id) => namesOf.get(id) ?? "").join("; ")}</p>
                  <p className="text-muted-foreground">
                    {attention.room.length > 0
                      ? `Room at ${attention.room.map((r) => `${tableName(r.tableId)} (${r.free} ${r.free === 1 ? "seat" : "seats"})`).join("; ")}.`
                      : "No table has a free seat."}
                  </p>
                </div>
              )}
              <Button size="lg" nativeButton={false} render={<Link href={groupPath(group.id, `/dinner-club/seasons/${season.id}/tables`)} />}>
                Open tables
              </Button>
            </CardContent>
          </Card>
        )}

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
              canChange={status === "open" || status === "published"}
              published={status === "published"}
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
