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
import {
  SignUpForm,
  type AddressFields,
  type ExistingSignUp,
  type LastSeasonPrefill,
} from "@/components/dinnerClub/SignUpForm";
import { WaitlistForm } from "@/components/dinnerClub/WaitlistForm";
import { WithdrawButton } from "@/components/dinnerClub/WithdrawButton";
import { seasonAttention } from "@/lib/dinnerClub/attention";
import { formatAddress } from "@/lib/dinnerClub/ics";
import {
  dinnerOpen,
  dinnerWhen,
  FORMAT_HELP,
  FORMAT_LABELS,
  isReplyStatus,
  partyName,
  STATUS_LABELS,
} from "@/lib/dinnerClub/labels";
import type { DinnerFormat } from "@/lib/dinnerClub/shuffle";
import { groupPath } from "@/lib/groups/active";
import { requireActiveGroup } from "@/lib/groups/server";
import { groupPageTitle } from "@/lib/pageTitle";
import { getOptionalUser } from "@/lib/supabase/current-user";
import { createClient } from "@/lib/supabase/server";
import { getOrgTimeZone } from "@/lib/time/orgZone";
import { dayKey, formatEventDate } from "@/lib/time/zone";
import {
  currentSeason,
  loadGroupPeople,
  loadLastSeasonSignUp,
  loadPeople,
  loadSeasonData,
  loadSeasons,
  peopleOf,
  shuffleParties,
  type AddressRow,
  type SeasonData,
} from "./load";

export const generateMetadata = groupPageTitle("Dinner club");

const NO_ADDRESS: AddressFields = { address_line1: "", address_line2: "", city: "", state: "", postal_code: "" };

function text(value: string | null | undefined): string {
  return value ?? "";
}

function addressFields(a: AddressRow): AddressFields {
  return {
    address_line1: a.address_line1,
    address_line2: text(a.address_line2),
    city: text(a.city),
    state: text(a.state),
    postal_code: text(a.postal_code),
  };
}

const WITHDRAW = {
  label: "Withdraw from this season",
  title: "Withdraw from this season?",
  description: "Your seats at dinners still to come are freed. Dinners that have happened keep you.",
  done: "You've withdrawn from this season.",
};

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
  const today = dayKey(new Date().toISOString(), zone);
  // Sign-ups stay open through the close date, as the sign-up form does.
  const statusLabel = status === "open" && today > season.signup_closes_on ? "Sign-ups closed" : STATUS_LABELS[status];
  const header = (
    <PageHeader
      title={season.title}
      subtitle={`${statusLabel} · ${FORMAT_LABELS[format]}`}
      actions={
        isLeader ? (
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button size="lg" variant="outline" nativeButton={false} render={<Link href={seasonPath(season.id)} />}>
              Manage season
            </Button>
            {season.status === "ended" && (
              <Button
                size="lg"
                variant="outline"
                nativeButton={false}
                render={<Link href={`${groupPath(group.id, "/dinner-club/seasons/new")}?from=${season.id}`} />}
              >
                Start next season
              </Button>
            )}
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

  const data = await loadSeasonData(supabase, season.id);
  if (!data) {
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
    const windowOpen = today <= season.signup_closes_on;
    const people = windowOpen ? await loadGroupPeople(supabase, group.id) : null;
    const last =
      windowOpen && !myParty && season.previous_season_id
        ? await loadLastSeasonSignUp(supabase, season.previous_season_id, user.id)
        : null;
    if (windowOpen && !people) {
      return (
        <PageContainer>
          {header}
          <ErrorState thing="this season" />
        </PageContainer>
      );
    }
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
        {people ? (
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
            lastSeason={
              last && {
                ...last,
                address: last.address ? addressFields(last.address) : null,
              }
            }
          />
        ) : (
          <Card>
            <CardContent className="space-y-4 pt-6 text-lg">
              <p>Sign-ups are closed. {myParty ? "You're signed up; " : ""}Tables come next.</p>
              {myParty && myParty.status !== "withdrawn" && <WithdrawButton partyId={myParty.id} {...WITHDRAW} />}
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
  // A name the viewer can't read, such as someone who has left the group.
  const UNNAMED = "A member";
  const firstNameOf = new Map(tablePeople.map((p) => [p.id, p.firstName]));
  const { data: feedToken } = await supabase.from("dinner_feed_tokens").select("profile_id").eq("profile_id", user.id).maybeSingle();

  const attention = isLeader
    ? seasonAttention({
        status,
        format,
        parties: data.parties,
        shuffleParties: shuffleParties(data),
        tables: data.tables,
        seats: data.seats,
        dinners: data.dinners,
        dateIds: data.dates.map((d) => d.id),
        tableSizeMax: season.table_size_max,
        now: new Date(),
      })
    : null;
  const needs = attention
    ? [
        attention.waiting.length > 0 &&
          `${attention.waiting.length} ${attention.waiting.length === 1 ? "party is" : "parties are"} waiting for a table.`,
        attention.cantHost.length + attention.hostLeft.length > 0 &&
          `${attention.cantHost.length + attention.hostLeft.length} ${attention.cantHost.length + attention.hostLeft.length === 1 ? "dinner needs" : "dinners need"} a host.`,
      ].filter((line): line is string => Boolean(line))
    : [];
  const leaderNotice = needs.length > 0 && (
    <Card className="mb-6 border-brand-primary/40">
      <CardContent className="flex flex-col gap-4 pt-6 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-lg font-semibold">{needs.join(" ")}</p>
        <Button size="lg" variant="outline" nativeButton={false} render={<Link href={seasonPath(season.id)} />}>
          Open the season
        </Button>
      </CardContent>
    </Card>
  );

  const myTables = new Set(
    data.seats.filter((s) => s.party_id === myPartyId && !s.left_at).map((s) => s.table_id)
  );
  const dinners = data.dinners.filter((d) => myTables.has(d.table_id));
  const now = new Date().getTime();
  const upcoming = dinners.filter((d) => new Date(d.starts_at).getTime() > now);
  const past = dinners.filter((d) => new Date(d.starts_at).getTime() <= now);

  if (!myParty && status === "published") {
    const people = await loadGroupPeople(supabase, group.id);
    const signedUp = new Set(data.members.map((m) => m.profile_id));
    return (
      <PageContainer size="reading">
        {header}
        {leaderNotice}
        <p className="mb-6 text-lg">You&apos;re not at a table this season.</p>
        {people ? (
          <WaitlistForm
            seasonId={season.id}
            meId={user.id}
            partners={people.filter((p) => p.id !== user.id && !signedUp.has(p.id)).map((p) => ({ value: p.id, label: p.name }))}
          />
        ) : (
          <ErrorState thing="this season" />
        )}
      </PageContainer>
    );
  }

  if (!myParty || myParty.status !== "signed_up" || dinners.length === 0) {
    return (
      <PageContainer size="reading">
        {header}
        {leaderNotice}
        <Card>
          <CardContent className="space-y-4 pt-6 text-lg">
            <p>
              {myParty?.status === "waitlisted"
                ? "You're on the waiting list. The leader will find you a table."
                : myParty?.status === "withdrawn"
                  ? "You've withdrawn from this season."
                  : "You're not at a table this season."}
            </p>
            {myParty && myParty.status !== "withdrawn" && status === "published" && (
              <WithdrawButton
                partyId={myParty.id}
                {...(myParty.status === "waitlisted"
                  ? {
                      label: "Leave the waiting list",
                      title: "Leave the waiting list?",
                      description: "You come off the waiting list for this season.",
                      done: "You've left the waiting list.",
                    }
                  : WITHDRAW)}
              />
            )}
          </CardContent>
        </Card>
      </PageContainer>
    );
  }

  const dateIndex = new Map(data.dates.map((d, i) => [d.id, i]));
  const startsOf = new Map(data.dinners.map((d) => [d.id, d.starts_at]));
  const bringOn = season.bring_list_enabled;

  const card = (d: SeasonData["dinners"][number], heading: string) => {
    const seated = data.seats.filter((s) => s.table_id === d.table_id && !s.left_at).map((s) => s.party_id);
    const atTable = seated.flatMap((partyId) => peopleOf(data, partyId)).map((id) => ({ id, name: nameOf.get(id) ?? UNNAMED }));
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
              ? [{ names: partyName(peopleOf(data, partyId).map((id) => firstNameOf.get(id) ?? UNNAMED)), notes: note.food_notes }]
              : [];
          })
      : [];
    const open = dinnerOpen(status, d.starts_at, new Date(now));
    const items = data.contributions.filter((c) => c.dinner_id === d.id);
    const guests = seated.filter((partyId) => partyId !== d.host_party_id);
    const bringList =
      isHost && open && bringOn
        ? {
            dinner: { id: d.id, seasonId: season.id, groupId: group.id, tableId: d.table_id, label: dinnerWhen(d.starts_at, zone) },
            guests: guests.map((partyId) => ({
              partyId,
              names: partyName(peopleOf(data, partyId).map((id) => firstNameOf.get(id) ?? UNNAMED)),
              item: items.find((c) => c.party_id === partyId)?.item ?? null,
            })),
            earlier: Object.fromEntries(
              guests.map((partyId) => [
                partyId,
                data.contributions
                  .filter((c) => c.party_id === partyId && (startsOf.get(c.dinner_id) ?? "") < d.starts_at)
                  .sort((a, b) => (startsOf.get(a.dinner_id) ?? "").localeCompare(startsOf.get(b.dinner_id) ?? ""))
                  .map((c) => c.item),
              ])
            ),
            dinnerIndex: dateIndex.get(d.season_date_id) ?? 0,
          }
        : null;
    return (
      <DinnerCard
        key={d.id}
        dinnerId={d.id}
        startsAt={d.starts_at}
        zone={zone}
        seasonTitle={season.title}
        heading={heading}
        hostNames={d.host_party_id ? partyName(peopleOf(data, d.host_party_id).map((id) => firstNameOf.get(id) ?? UNNAMED)) : null}
        address={address ? formatAddress(address) : null}
        atTable={atTable}
        replies={replies}
        mine={[user.id, ...(partnerId ? [partnerId] : [])].map((id) => ({ id, name: firstNameOf.get(id) ?? UNNAMED }))}
        open={open}
        isHost={isHost}
        canMove={open && (isHost || isLeader)}
        foodNotes={foodNotes}
        bringing={bringOn && !isHost ? (items.find((c) => c.party_id === myPartyId)?.item ?? null) : null}
        hostUnavailable={d.host_unavailable}
        bringList={bringList}
      />
    );
  };

  return (
    <PageContainer size="reading">
      {header}
      {leaderNotice}
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
        {status === "published" && <WithdrawButton partyId={myParty.id} {...WITHDRAW} />}
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
  lastSeason,
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
  lastSeason: LastSeasonPrefill | null;
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
        address: address ? addressFields(address) : null,
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
      lastSeason={existing ? null : lastSeason}
    />
  );
}
