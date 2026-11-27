"use client";

import Link from "next/link";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { buttonVariants } from "@/components/ui/button-variants";
import { Heart, Home, MapPin, Pencil } from "lucide-react";
import { formatPhone } from "@/lib/sanitize";
import { isChildWithoutAccount } from "@/lib/household";
import { childGradeLabel } from "@/lib/grade";
import { displayName, initials } from "@/lib/names";
import { DirRow, PhoneText } from "@/components/directory/DirRow";
import { isOwnHousehold } from "@/components/directory/ownEntry";
import { profileHouseholdHref } from "@/lib/profileTabs";
import { formatAnniversary, householdPhoneLabel, relLabel } from "@/components/directory/utils";
import { LiveHideButton, LiveUnavailableNote, NOT_AVAILABLE, useLiveControls } from "@/components/directory/LiveDetailsContext";
import type {
  DirectoryProfile,
  FamilyDirectoryFull,
  HouseholdFamilyMember,
  HouseholdMember,
} from "@/lib/types";

const REL_ORDER: Record<string, number> = {
  primary: 0,
  spouse: 1,
  child: 2,
  parent: 3,
  sibling: 4,
};

function relRank(rel: string): number {
  return REL_ORDER[rel] ?? 9;
}

function MemberAvatar({ member }: { member: HouseholdMember | HouseholdFamilyMember }) {
  const name = displayName(member);
  return (
    <Avatar className="h-11 w-11">
      {member.avatar_url && <AvatarImage src={member.avatar_url} alt={name} />}
      <AvatarFallback className="bg-brand-primary text-white text-sm">
        {initials(member)}
      </AvatarFallback>
    </Avatar>
  );
}

interface FamilyCardProps {
  family: FamilyDirectoryFull;
  profileMap: Record<string, DirectoryProfile>;
  onOpenPerson: (profile: DirectoryProfile) => void;
  viewerFamilyId: string | null;
  /** The church's calendar date, for a child's grade. */
  today: Date;
}

/**
 * Household detail: each member as a row (tappable when they have a
 * directory profile), then the shared home phone and address.
 */
export function FamilyCard({ family, profileMap, onOpenPerson, viewerFamilyId, today }: FamilyCardProps) {
  const hasSpouse =
    family.members.some((m) => m.relationship === "spouse") ||
    family.family_members_list.some((fm) => fm.relationship === "spouse");

  const showAnniversary = !!(family.anniversary_month && family.anniversary_day && hasSpouse);
  const live = useLiveControls()?.live;
  const slots = live?.households[family.id];
  const own = live?.canHide.household === family.id;
  const addressFallback = family.address_line1
    ? null
    : slots?.address?.state === "unavailable"
      ? NOT_AVAILABLE
      : own && slots?.address?.state === "hidden"
        ? "not shown in the directory"
        : null;
  const anniversaryFallback =
    showAnniversary || !hasSpouse
      ? null
      : slots?.anniversary?.state === "unavailable"
        ? NOT_AVAILABLE
        : own && slots?.anniversary?.state === "hidden"
          ? "not shown in the directory"
          : null;

  const members = [...family.members].sort(
    (a, b) => relRank(a.relationship) - relRank(b.relationship),
  );
  // Skip family-member records already represented by a claimed profile
  const familyMembers = family.family_members_list
    .filter((fm) => !fm.claimed_profile_id)
    .sort((a, b) => relRank(a.relationship) - relRank(b.relationship));

  return (
    <div className="space-y-4">
      {family.photo_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={family.photo_url}
          alt={`${family.family_name} household photo`}
          className="w-full aspect-[4/3] object-cover rounded-xl"
        />
      )}

      <h2 className="font-serif text-2xl md:text-3xl font-medium text-foreground">
        {family.family_name}
      </h2>
      <LiveUnavailableNote />

      <div className="space-y-2.5">
        {members.map((m) => {
          const fullProfile = profileMap[m.id];
          const subtitle = m.phone_mobile ? (
            <>
              <PhoneText phone={m.phone_mobile} /> · mobile
            </>
          ) : m.relationship !== "primary"
              ? relLabel(m.relationship)
              : undefined;
          return (
            <DirRow
              key={m.id}
              onClick={fullProfile ? () => onOpenPerson(fullProfile) : undefined}
              avatar={<MemberAvatar member={m} />}
              title={displayName(m)}
              subtitle={subtitle}
            />
          );
        })}
        {familyMembers.map((fm) => (
          <DirRow
            key={fm.id}
            avatar={<MemberAvatar member={fm} />}
            title={displayName(fm)}
            subtitle={
              childGradeLabel(fm, today) ??
              (live?.children[fm.id]?.grade?.state === "unavailable" ? `Grade — ${NOT_AVAILABLE}` : undefined) ??
              (isChildWithoutAccount(fm) ? undefined : relLabel(fm.relationship))
            }
          />
        ))}
      </div>

      {(family.phone_home || family.address_line1 || showAnniversary || addressFallback || anniversaryFallback) && (
        <div>
          {family.phone_home && (
            <div className="flex items-center gap-3 py-1.5">
              <Home className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <a
                href={`tel:${family.phone_home}`}
                className="inline-flex min-h-11 items-center whitespace-nowrap text-brand-primary-text font-semibold underline underline-offset-4 hover:text-foreground"
              >
                {formatPhone(family.phone_home)}
              </a>
              <span className="text-base text-muted-foreground">{householdPhoneLabel(family)}</span>
            </div>
          )}
          {family.address_line1 && (
            <div className="flex items-start gap-3 py-1.5">
              <MapPin className="h-5 w-5 shrink-0 text-muted-foreground mt-1" aria-hidden="true" />
              <span className="text-base">
                {family.address_line1}
                {family.address_line2 && (
                  <>
                    <br />
                    {family.address_line2}
                  </>
                )}
                <br />
                {family.city}
                {family.state && `, ${family.state}`}
                {family.postal_code && ` ${family.postal_code}`}
                {own && slots?.address?.state === "shown" && (
                  <>
                    <br />
                    <LiveHideButton field="address" hidden={false} />
                  </>
                )}
              </span>
            </div>
          )}
          {addressFallback && (
            <div className="flex items-center gap-3 py-1.5">
              <MapPin className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="text-base">
                Address — {addressFallback}
                {addressFallback !== NOT_AVAILABLE && <LiveHideButton field="address" hidden />}
              </span>
            </div>
          )}
          {showAnniversary && (
            <div className="flex items-center gap-3 py-1.5">
              <Heart className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="text-base">
                Anniversary —{" "}
                {formatAnniversary(family.anniversary_month!, family.anniversary_day!, family.anniversary_year)}
                {own && slots?.anniversary?.state === "shown" && <LiveHideButton field="anniversary" hidden={false} />}
              </span>
            </div>
          )}
          {anniversaryFallback && (
            <div className="flex items-center gap-3 py-1.5">
              <Heart className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="text-base">
                Anniversary — {anniversaryFallback}
                {anniversaryFallback !== NOT_AVAILABLE && <LiveHideButton field="anniversary" hidden />}
              </span>
            </div>
          )}
        </div>
      )}

      {isOwnHousehold(family, viewerFamilyId) && (
        <div className="pt-3 border-t border-border">
          <Link href={profileHouseholdHref()} className={buttonVariants()}>
            <Pencil aria-hidden="true" />
            Edit household
          </Link>
        </div>
      )}
    </div>
  );
}
