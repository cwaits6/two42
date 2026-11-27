"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { MyProfileView } from "@/components/profile/MyProfileView";
import { HouseholdClient } from "@/components/household/HouseholdClient";
import { HOUSEHOLD_TAB } from "@/lib/profileTabs";
import type { HouseholdSummary } from "@/lib/household";
import type { FamilyMember, FamilyUnit, Profile } from "@/lib/types";
import { NOTICE_FIELDS, type ProfileRecords } from "@/lib/integrations/records/labels";
import type { SuggestedChild } from "@/lib/integrations/records/profileRecords";

interface ProfileHouseholdTabsProps {
  profile: Profile;
  family: FamilyUnit | null;
  householdProfiles: (Profile | HouseholdSummary)[];
  familyMembers: FamilyMember[];
  /** The church's calendar date, YYYY-MM-DD, for working out a child's grade. */
  today: string;
  records?: ProfileRecords | null;
  /** Each household member's records state, by profile id, for the edit sheet. */
  householdRecords?: Record<string, ProfileRecords>;
  /** Which of the household's own details came from the church's records. */
  householdDetailRecords?: ProfileRecords | null;
  /** Children the church's records suggest to the household's primary and spouse. */
  suggestedChildren?: SuggestedChild[];
}

function ProfileHouseholdTabsInner({
  profile,
  family,
  householdProfiles,
  familyMembers,
  today,
  records = null,
  householdRecords = {},
  householdDetailRecords = null,
  suggestedChildren = [],
}: ProfileHouseholdTabsProps) {
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<string>(
    searchParams.get("tab") === HOUSEHOLD_TAB ? HOUSEHOLD_TAB : "me",
  );

  // A records notice link names a field by its id, which a hidden tab can't
  // scroll to, so the link opens that field's tab first.
  const focusAfterSwitch = useRef<string | null>(null);
  useEffect(() => {
    const follow = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      const target = Object.values(NOTICE_FIELDS).find((f) => f?.href.endsWith(`#${id}`));
      if (!id || !target) return;
      focusAfterSwitch.current = id;
      setActiveTab(target.household ? HOUSEHOLD_TAB : "me");
    };
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, []);
  useEffect(() => {
    const id = focusAfterSwitch.current;
    const field = id ? document.getElementById(id) : null;
    if (!field) return;
    focusAfterSwitch.current = null;
    field.scrollIntoView({ block: "center" });
    field.focus();
  }, [activeTab]);

  // Without a family there is no household to manage — just the self-edit view.
  if (!family) {
    return <MyProfileView profile={profile} family={null} records={records} />;
  }

  return (
    <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as string)}>
      <TabsList className="mb-6">
        <TabsTrigger value="me" className="text-base px-6">
          Me
        </TabsTrigger>
        <TabsTrigger value={HOUSEHOLD_TAB} className="text-base px-6">
          Household
        </TabsTrigger>
      </TabsList>

      <TabsContent value="me">
        <MyProfileView profile={profile} family={family} records={records} />
      </TabsContent>
      <TabsContent value={HOUSEHOLD_TAB}>
        <HouseholdClient
          currentProfile={profile}
          family={family}
          initialFamilyMembers={familyMembers}
          householdProfiles={householdProfiles}
          today={today}
          householdRecords={householdRecords}
          householdDetailRecords={householdDetailRecords}
          suggestedChildren={suggestedChildren}
          onEditSelf={() => setActiveTab("me")}
        />
      </TabsContent>
    </Tabs>
  );
}

export function ProfileHouseholdTabs(props: ProfileHouseholdTabsProps) {
  return (
    <Suspense fallback={null}>
      <ProfileHouseholdTabsInner {...props} />
    </Suspense>
  );
}
