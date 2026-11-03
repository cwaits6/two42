export interface DeletionSummary {
  name: string;
  lastChurchAdmin: boolean;
  /** Funds that go to this person; the foreign key deletes them with the profile. */
  funds: { name: string; group: string }[];
  /** `shared` households stay. A household with no one else left goes, with `entries`. */
  household: { name: string; shared: boolean; entries: string[] } | null;
  /** Groups this person is the only leader of. */
  groupsLosingLeader: string[];
}

export type DeletionSubject = "self" | "other";

export const LAST_CHURCH_ADMIN_MESSAGE: Record<DeletionSubject, string> = {
  self: "A church needs at least one church admin, so add another before deleting your account.",
  other: "A church needs at least one church admin, so add another before removing this person.",
};

export interface DeletionCopy {
  title: string;
  description: string;
  goes: string[];
  stays: string[];
  confirmLabel: string;
  pendingLabel: string;
}

function householdGoes(household: NonNullable<DeletionSummary["household"]>): string {
  const base = `The ${household.name} household`;
  return household.entries.length > 0
    ? `${base}, and the people listed in it: ${household.entries.join(", ")}`
    : base;
}

/** What the confirmation says goes and stays, worded for the person acting. */
export function deletionCopy(summary: DeletionSummary, subject: DeletionSubject): DeletionCopy {
  const self = subject === "self";
  const { funds, household, groupsLosingLeader } = summary;

  const goes = self
    ? [
        "Your profile, photo and sign-in",
        "Your group and team memberships, RSVPs and serving turns",
        "Your prayer requests, including anonymous ones",
      ]
    : [
        "Their profile, photo and sign-in",
        "Their group and team memberships, RSVPs and serving turns",
        "Their prayer requests, including anonymous ones",
      ];
  for (const fund of funds) {
    goes.push(`The ${fund.name} fund in ${fund.group}, and its payment methods`);
  }
  if (household && !household.shared) goes.push(householdGoes(household));

  const stays = [
    "Announcements, events and lessons, without the author's name",
    "Serving dates shared with someone else, which stay with that person",
    "Feedback already sent, without a name",
  ];
  if (household?.shared) {
    stays.unshift(`The ${household.name} household, and everyone else's details in it`);
  }
  for (const group of groupsLosingLeader) {
    stays.push(`${group}, with no leader until a church admin adds one`);
  }

  return self
    ? {
        title: "Delete your account?",
        description: "You can't undo this. Download your data first if you want a copy.",
        goes,
        stays,
        confirmLabel: "Delete my account",
        pendingLabel: "Deleting…",
      }
    : {
        title: `Remove ${summary.name} from the church?`,
        description: "This deletes their account, and you can't undo it.",
        goes,
        stays,
        confirmLabel: "Remove from church",
        pendingLabel: "Removing…",
      };
}
