"use client";

import { useRouter } from "next/navigation";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ProfileForm } from "@/components/profile/ProfileForm";
import { DirectoryPreview } from "@/components/profile/DirectoryPreview";
import { displayName, initials } from "@/lib/names";
import { formatPhone } from "@/lib/sanitize";
import type { FamilyUnit, Profile } from "@/lib/types";

interface MyProfileViewProps {
  profile: Profile;
  family: FamilyUnit | null;
}

const eyebrow =
  "text-base font-bold uppercase tracking-wider text-muted-foreground";

export function MyProfileView({ profile, family }: MyProfileViewProps) {
  const router = useRouter();

  // Summary line mirrors what the directory shows: hidden fields stay hidden.
  const visiblePhone = profile.hide_phone_mobile ? null : profile.phone_mobile;
  const visibleCity = !profile.hide_address && profile.city
    ? `${profile.city}${profile.state ? `, ${profile.state}` : ""}`
    : family && !family.hide_address && family.city
      ? `${family.city}${family.state ? `, ${family.state}` : ""}`
      : null;
  const summary = [visiblePhone && formatPhone(visiblePhone), visibleCity]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="space-y-6">
      {/* How others see you */}
      <div className="rounded-xl border border-brand-primary/25 bg-brand-warm p-5 sm:px-6">
        <p className={`${eyebrow} mb-3`}>How others see you</p>
        <div className="flex items-center gap-4">
          <Avatar className="h-13 w-13 shrink-0">
            {profile.avatar_url && (
              <AvatarImage src={profile.avatar_url} alt={displayName(profile)} />
            )}
            <AvatarFallback className="bg-brand-primary text-white text-lg">
              {initials(profile)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="font-bold">{displayName(profile)}</p>
            <p className="text-base text-muted-foreground">
              {profile.is_unlisted
                ? "You're hidden from the directory."
                : summary || "No contact info shared yet."}
            </p>
          </div>
        </div>
        <div className="mt-4">
          <DirectoryPreview />
        </div>
      </div>

      {/* Household photo */}
      {family?.photo_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={family.photo_url}
          alt="Household photo"
          className="h-56 w-full rounded-xl object-cover sm:h-64"
        />
      )}

      {/* Personal details editor */}
      <ProfileForm
        profile={profile}
        families={[]}
        family={family}
        isAdmin={false}
        onSaved={() => router.refresh()}
      />
    </div>
  );
}
