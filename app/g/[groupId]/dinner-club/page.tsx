import Link from "next/link";
import { redirect } from "next/navigation";
import { UtensilsCrossed } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/states/EmptyState";
import { ErrorState } from "@/components/states/ErrorState";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CalendarLinkCard } from "@/components/dinnerClub/CalendarLinkCard";
import { DinnerCard } from "@/components/dinnerClub/DinnerCard";
import { SignUpForm, type AddressFields, type ExistingSignUp } from "@/components/dinnerClub/SignUpForm";
import { formatAddress } from "@/lib/dinnerClub/ics";
import { dinnerWhen, FORMAT_HELP, FORMAT_LABELS, isReplyStatus, partyName, STATUS_LABELS } from "@/lib/dinnerClub/labels";
import type { DinnerFormat } from "@/lib/dinnerClub/shuffle";
import { groupPath } from "@/lib/groups/active";
import { requireActiveGroup } from "@/lib/groups/server";
import { groupPageTitle } from "@/lib/pageTitle";
import { getOptionalUser } from "@/lib/supabase/current-user";
import { createClient } from "@/lib/supabase/server";
import { getOrgTimeZone } from "@/lib/time/orgZone";
import { dayKey, formatEventDate } from "@/lib/time/zone";
import { currentSeason, loadGroupPeople, loadPeople, loadSeasonData, loadSeasons, peopleOf, type SeasonData } from "./load";

export const generateMetadata = groupPageTitle("Dinner club");

const NO_ADDRESS: AddressFields = { address_line1: "", address_line2: "", city: "", state: "", postal_code: "" };

function text(value: string | null | undefined): string {
  return value ?? "";
}

export default async function DinnerClubPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const group = await requireActiveGroup(groupId);
  const user = await getOptionalUser();
  if (!user) redirect("/login");
  const supabase = await createClient();
  const zone = await getOrgTimeZone();
  const isLeader = group.role === "leader";
  const seasonPath = (id: string) => groupPath(group.id, `/dinner-club/seasons/${id}`);

  const seasons = await loadSeasons(supabase, group.id);
  if (!seasons) {
    return (
      <PageContainer>
        <PageHeader title="Dinner club" />
        <ErrorState thing="the dinner club" />
      </PageContainer>
    );
  }
  const season = currentSeason(seasons);
  const running = seasons.some((s) => s.status === "open" || s.status === "published" || s.status === "draft");
  const addSeason = (
    <Button size="lg" nativeButton={false} render={<Link href={groupPath(group.id, "/dinner-club/seasons/new")} />}>
      Add season
    </Button>
  );

  if (!season) {
    return (
      <PageContainer>
        <PageHeader title="Dinner club" subtitle="Dinners in members' homes, a season at a time." />
        <EmptyState icon={UtensilsCrossed} message="No dinner club season yet" action={isLeader ? addSeason : undefined} />
      </PageContainer>
    );
  }

  const { status, format } = season;
  const header = (
    <PageHeader
      title={season.title}
      subtitle={`${STATUS_LABELS[status]} · ${FORMAT_LABELS[format]}`}
      actions={
        isLeader ? (
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button size="lg" variant="outline" nativeButton={false} render={<Link href={seasonPath(season.id)} />}>
              Manage season
            </Button>
            {!running && addSeason}
          </div>
        ) : undefined
      }
    />
  );

  if (status === "draft") {
    return (
      <PageContainer>
        {header}
        <Card>
          <CardContent className="pt-6 text-lg">
            This season is a draft. Members see nothing until you open sign-ups.
          </CardContent>
        </Card>
      </PageContainer>
    );
  }

  const [data, people] = await Promise.all([loadSeasonData(supabase, season.id), loadGroupPeople(supabase, group.id)]);
  if (!data || !people) {
    return (
      <PageContainer>
        {header}
        <ErrorState thing="this season" />
      </PageContainer>
    );
  }

  const myPartyId = data.members.find((m) => m.profile_id === user.id)?.party_id ?? null;
  const myParty = data.parties.find((p) => p.id === myPartyId) ?? null;
  const partnerId = myPartyId ? peopleOf(data, myPartyId).find((id) => id !== user.id) ?? null : null;

  if (status === "open") {
    const today = dayKey(new Date().toISOString(), zone);
    const windowOpen = today <= season.signup_closes_on;
    return (
      <PageContainer size="reading">
        {header}
        <Card className="mb-6">
          <CardContent className="space-y-3 pt-6 text-lg">
            <p>{FORMAT_HELP[format]}</p>
            {windowOpen && <p>Sign up by {formatEventDate(`${season.signup_closes_on}T12:00:00Z`, "UTC")}.</p>}
            {data.dates.length > 0 && (
              <div>
                <p className="font-semibold">Dinners</p>
                <ul className="list-disc pl-6">
                  {data.dates.map((d) => (
                    <li key={d.id}>{dinnerWhen(d.starts_at, zone)}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
        {windowOpen ? (
          <SignUpView
            data={data}
            people={people}
            meId={user.id}
            partnerId={partnerId}
            myParty={myParty}
            seasonId={season.id}
            groupId={group.id}
            format={format}
            zone={zone}
            supabase={supabase}
          />
        ) : (
          <Card>
            <CardContent className="pt-6 text-lg">
              Sign-ups are closed. {myParty ? "You're signed up; " : ""}Tables come next.
            </CardContent>
          </Card>
        )}
      </PageContainer>
    );
  }

  // Published or ended: only the person's own tables are readable.
  const tablePeople = await loadPeople(supabase, data.members.map((m) => m.profile_id));
  if (!tablePeople) {
    return (
      <PageContainer>
        {header}
        <ErrorState thing="your table" />
      </PageContainer>
    );
  }
  const nameOf = new Map(tablePeople.map((p) => [p.id, p.name]));
  const firstNameOf = new Map(tablePeople.map((p) => [p.id, p.firstName]));
  const { data: feedToken } = await supabase.from("dinner_feed_tokens").select("profile_id").eq("profile_id", user.id).maybeSingle();

  const myTables = new Set(
    data.seats.filter((s) => s.party_id === myPartyId && !s.left_at).map((s) => s.table_id)
  );
  const dinners = data.dinners.filter((d) => myTables.has(d.table_id));
  const now = new Date().getTime();
  const upcoming = dinners.filter((d) => new Date(d.starts_at).getTime() > now);
  const past = dinners.filter((d) => new Date(d.starts_at).getTime() <= now);

  if (!myParty || dinners.length === 0) {
    return (
      <PageContainer size="reading">
        {header}
        <Card>
          <CardContent className="pt-6 text-lg">
            {myParty?.status === "waitlisted"
              ? "You're on the waiting list. The leader will find you a table."
              : "You're not at a table this season."}
          </CardContent>
        </Card>
      </PageContainer>
    );
  }

  const card = (d: SeasonData["dinners"][number], heading: string) => {
    const seated = data.seats.filter((s) => s.table_id === d.table_id && !s.left_at).map((s) => s.party_id);
    const atTable = seated.flatMap((partyId) => peopleOf(data, partyId)).map((id) => ({ id, name: nameOf.get(id) ?? "" }));
    const isHost = d.host_party_id === myPartyId;
    const address = data.addresses.find((a) => a.party_id === d.host_party_id);
    const replies = Object.fromEntries(
      data.replies
        .filter((r) => r.dinner_id === d.id)
        .flatMap((r) => (isReplyStatus(r.status) ? [[r.profile_id, r.status] as const] : []))
    );
    const foodNotes = isHost
      ? seated
          .filter((partyId) => peopleOf(data, partyId).some((id) => replies[id] === "going"))
          .flatMap((partyId) => {
            const note = data.notes.find((n) => n.party_id === partyId);
            return note
              ? [{ names: partyName(peopleOf(data, partyId).map((id) => firstNameOf.get(id) ?? "")), notes: note.food_notes }]
              : [];
          })
      : [];
    const open = status === "published" && new Date(d.starts_at).getTime() > now;
    return (
      <DinnerCard
        key={d.id}
        dinnerId={d.id}
        startsAt={d.starts_at}
        zone={zone}
        seasonTitle={season.title}
        heading={heading}
        hostNames={d.host_party_id ? partyName(peopleOf(data, d.host_party_id).map((id) => firstNameOf.get(id) ?? "")) : null}
        address={address ? formatAddress(address) : null}
        atTable={atTable}
        replies={replies}
        mine={[user.id, ...(partnerId ? [partnerId] : [])].map((id) => ({ id, name: firstNameOf.get(id) ?? "" }))}
        open={open}
        isHost={isHost}
        canMove={open && (isHost || isLeader)}
        foodNotes={foodNotes}
      />
    );
  };

  return (
    <PageContainer size="reading">
      {header}
      <div className="space-y-8">
        {upcoming[0] && card(upcoming[0], "Your next dinner")}
        {upcoming.slice(1).map((d) => card(d, "Later"))}
        <CalendarLinkCard hasLink={Boolean(feedToken)} />
        {past.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-2xl font-bold">Past dinners</h2>
            <ul className="space-y-2 text-lg">
              {past.map((d) => (
                <li key={d.id}>{dinnerWhen(d.starts_at, zone)}</li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </PageContainer>
  );
}

async function SignUpView({
  data,
  people,
  meId,
  partnerId,
  myParty,
  seasonId,
  groupId,
  format,
  zone,
  supabase,
}: {
  data: SeasonData;
  people: { id: string; name: string; familyId: string | null }[];
  meId: string;
  partnerId: string | null;
  myParty: SeasonData["parties"][number] | null;
  seasonId: string;
  groupId: string;
  format: DinnerFormat;
  zone: string;
  supabase: Awaited<ReturnType<typeof createClient>>;
}) {
  const me = people.find((p) => p.id === meId);
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  const signedUp = new Set(data.members.map((m) => m.profile_id));
  const free = people.filter((p) => p.id !== meId && !signedUp.has(p.id));
  const household = free.filter((p) => me?.familyId && p.familyId === me.familyId);
  const others = free.filter((p) => !household.includes(p));

  let prefill = NO_ADDRESS;
  if (!myParty) {
    const { data: home } = me?.familyId
      ? await supabase
          .from("family_units")
          .select("address_line1, address_line2, city, state, postal_code")
          .eq("id", me.familyId)
          .maybeSingle()
      : { data: null };
    const { data: own } = home?.address_line1
      ? { data: null }
      : await supabase.from("profiles").select("address_line1, address_line2, city, state, postal_code").eq("id", meId).maybeSingle();
    const source = home?.address_line1 ? home : own;
    if (source) {
      prefill = {
        address_line1: text(source.address_line1),
        address_line2: text(source.address_line2),
        city: text(source.city),
        state: text(source.state),
        postal_code: text(source.postal_code),
      };
    }
  }

  const address = myParty ? data.addresses.find((a) => a.party_id === myParty.id) : undefined;
  const existing: ExistingSignUp | null = myParty
    ? {
        partyId: myParty.id,
        partnerName: partnerId ? (nameOf.get(partnerId) ?? null) : null,
        canHost: myParty.can_host,
        seats: myParty.seats,
        preferredDateId: myParty.preferred_season_date_id,
        kidsWelcome: myParty.kids_welcome ?? false,
        accessNotes: text(myParty.access_notes),
        pets: text(myParty.pets),
        address: address
          ? {
              address_line1: address.address_line1,
              address_line2: text(address.address_line2),
              city: text(address.city),
              state: text(address.state),
              postal_code: text(address.postal_code),
            }
          : null,
        foodNotes: data.notes.find((n) => n.party_id === myParty.id)?.food_notes ?? "",
        unavailable: data.unavailable.filter((u) => u.party_id === myParty.id).map((u) => u.season_date_id),
      }
    : null;

  return (
    <SignUpForm
      key={myParty?.id ?? "new"}
      seasonId={seasonId}
      groupId={groupId}
      format={format}
      meId={meId}
      household={household.map((p) => ({ value: p.id, label: p.name }))}
      others={others.map((p) => ({ value: p.id, label: p.name }))}
      dates={data.dates.map((d) => ({ value: d.id, label: dinnerWhen(d.starts_at, zone) }))}
      existing={existing}
      prefill={prefill}
    />
  );
}
