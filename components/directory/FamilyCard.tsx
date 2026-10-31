"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Heart, Home, MapPin } from "lucide-react";
import { formatPhone } from "@/lib/sanitize";
import { displayName, initials } from "@/lib/names";
import { DirRow, PhoneText } from "@/components/directory/DirRow";
import { formatAnniversary, relLabel } from "@/components/directory/utils";
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
}

/**
 * Household detail: each member as a row (tappable when they have a
 * directory profile), then the shared home phone and address.
 */
export function FamilyCard({ family, profileMap, onOpenPerson }: FamilyCardProps) {
  const hasSpouse =
    family.members.some((m) => m.relationship === "spouse") ||
    family.family_members_list.some((fm) => fm.relationship === "spouse");

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
            subtitle={relLabel(fm.relationship)}
          />
        ))}
      </div>

      {(family.phone_home || family.address_line1 || (family.anniversary && hasSpouse)) && (
        <div>
          {family.phone_home && (
            <div className="flex items-center gap-3 py-1.5">
              <Home className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <a
                href={`tel:${family.phone_home}`}
                className="whitespace-nowrap text-brand-primary-text font-semibold underline underline-offset-4 hover:text-foreground"
              >
                {formatPhone(family.phone_home)}
              </a>
              <span className="text-base text-muted-foreground">home</span>
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
              </span>
            </div>
          )}
          {family.anniversary && hasSpouse && (
            <div className="flex items-center gap-3 py-1.5">
              <Heart className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="text-base">
                Anniversary — {formatAnniversary(family.anniversary)}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
