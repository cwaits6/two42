"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Briefcase,
  Cake,
  Download,
  Home,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
} from "lucide-react";
import { formatPhone } from "@/lib/sanitize";
import { displayName, initials } from "@/lib/names";
import { GroupBadge } from "@/components/directory/GroupBadge";
import {
  downloadVCard,
  formatBirthdayShort,
  relLabel,
  resolveAddress,
} from "@/components/directory/utils";
import type { DirectoryProfile, FamilyDirectoryFull } from "@/lib/types";
import type { ComponentType, ReactNode } from "react";

function ContactLine({
  icon: Icon,
  children,
  kind,
  alignTop,
}: {
  icon: ComponentType<{ className?: string }>;
  children: ReactNode;
  kind?: string;
  alignTop?: boolean;
}) {
  return (
    <div className={`flex gap-3 py-1.5 ${alignTop ? "items-start" : "items-center"}`}>
      <Icon
        className={`h-5 w-5 shrink-0 text-muted-foreground ${alignTop ? "mt-1" : ""}`}
        aria-hidden="true"
      />
      <span className="min-w-0 text-base">{children}</span>
      {kind && <span className="text-base text-muted-foreground">{kind}</span>}
    </div>
  );
}

const contactLink =
  "text-brand-primary-text font-semibold underline underline-offset-4 hover:text-foreground";
const telLink = `${contactLink} whitespace-nowrap`;

interface PersonCardProps {
  profile: DirectoryProfile;
  family: FamilyDirectoryFull | null;
}

/**
 * Person detail: contact info plus a save-to-contacts action. Rendered in
 * the directory detail panels and the profile page's directory preview.
 */
export function PersonCard({ profile, family }: PersonCardProps) {
  const address = resolveAddress(profile, family);
  const hasBirthday = profile.birth_month && profile.birth_day;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center gap-5">
        <Avatar className="h-20 w-20 shrink-0">
          {profile.avatar_url && (
            <AvatarImage src={profile.avatar_url} alt={displayName(profile)} />
          )}
          <AvatarFallback className="bg-brand-primary text-white text-2xl">
            {initials(profile)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <h2 className="font-serif text-2xl md:text-3xl font-medium leading-tight text-foreground">
            {displayName(profile)}
          </h2>
          {profile.preferred_name &&
            profile.first_name &&
            profile.preferred_name !== profile.first_name && (
              <p className="text-base text-muted-foreground">
                ({profile.first_name} {profile.last_name})
              </p>
            )}
          {family && (
            <p className="text-base text-muted-foreground">{family.family_name}</p>
          )}
          {profile.relationship && profile.relationship !== "primary" && (
            <Badge variant="outline" className="text-base mt-1 capitalize">
              {relLabel(profile.relationship)}
            </Badge>
          )}
        </div>
      </div>

      {/* Groups */}
      {profile.groups && profile.groups.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {profile.groups.map((g) => (
            <GroupBadge key={g.id} group={g} />
          ))}
        </div>
      )}

      <div>
        {/* Phones */}
        {profile.phone_mobile && (
          <div className="flex items-center gap-3 py-1.5">
            <Phone className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <a href={`tel:${profile.phone_mobile}`} className={telLink}>
              {formatPhone(profile.phone_mobile)}
            </a>
            <span className="text-base text-muted-foreground">mobile</span>
            <a
              href={`sms:${profile.phone_mobile}`}
              className="ml-auto flex min-h-11 items-center gap-1.5 text-brand-primary-text hover:text-foreground"
            >
              <MessageSquare className="h-5 w-5" aria-hidden="true" />
              <span className="text-base font-medium">Text</span>
            </a>
          </div>
        )}
        {profile.phone_home && (
          <ContactLine icon={Home} kind="home">
            <a href={`tel:${profile.phone_home}`} className={telLink}>
              {formatPhone(profile.phone_home)}
            </a>
          </ContactLine>
        )}
        {!profile.phone_home && family?.phone_home && (
          <ContactLine icon={Home} kind="household">
            <a href={`tel:${family.phone_home}`} className={telLink}>
              {formatPhone(family.phone_home)}
            </a>
          </ContactLine>
        )}
        {profile.phone_work && (
          <ContactLine icon={Briefcase} kind="work">
            <a href={`tel:${profile.phone_work}`} className={telLink}>
              {formatPhone(profile.phone_work)}
            </a>
          </ContactLine>
        )}

        {/* Email */}
        {profile.email && (
          <ContactLine icon={Mail}>
            <a href={`mailto:${profile.email}`} className={`${contactLink} break-all`}>
              {profile.email}
            </a>
          </ContactLine>
        )}

        {/* Address */}
        {address && (
          <ContactLine icon={MapPin} alignTop>
            <span>
              {address.line1}
              {address.line2 && (
                <>
                  <br />
                  {address.line2}
                </>
              )}
              <br />
              {address.city}
              {address.state && `, ${address.state}`}
              {address.postal && ` ${address.postal}`}
            </span>
          </ContactLine>
        )}

        {/* Birthday */}
        {hasBirthday && (
          <ContactLine icon={Cake}>
            Birthday — {formatBirthdayShort(profile.birth_month!, profile.birth_day!)}
          </ContactLine>
        )}

        {/* Occupation */}
        {(profile.occupation || profile.employer) && (
          <ContactLine icon={Briefcase} alignTop>
            <span>
              {profile.occupation}
              {profile.employer && (
                <span className="block text-base text-muted-foreground">
                  {profile.employer}
                </span>
              )}
            </span>
          </ContactLine>
        )}
      </div>

      {/* Save to Contacts */}
      <div className="pt-3 border-t border-border">
        <Button
          variant="outline"
          onClick={() => downloadVCard(profile.id)}
          className="gap-2 text-brand-primary-text"
        >
          <Download className="h-4 w-4" />
          Save to my phone contacts
        </Button>
      </div>
    </div>
  );
}
