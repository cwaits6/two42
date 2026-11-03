export type DeletionViewer = "self" | "church_admin";

interface NamedFund {
  name: string;
  group: string;
}

/** Funds and groups, by name for the person themself and only counted for a church admin. */
export type DeletionGroupContent =
  | {
      kind: "names";
      /** Go to the second person, retired. */
      fundsRetired: (NamedFund & { recipient: string })[];
      /** No second person in the group, so the foreign key deletes them with the profile. */
      fundsDeleted: NamedFund[];
      /** Groups this person is the only leader of. */
      groupsLosingLeader: string[];
    }
  | { kind: "counts"; fundsRetired: number; fundsDeleted: number; groupsLosingLeader: number };

export interface DeletionSummary {
  name: string;
  lastChurchAdmin: boolean;
  platformOperator: boolean;
  groupContent: DeletionGroupContent;
  /** `shared` households stay. A household with no one else left goes, with `entries`. */
  household: { name: string; shared: boolean; entries: string[] } | null;
}

export type DeletionSubject = "self" | "other";

export const LAST_CHURCH_ADMIN_MESSAGE: Record<DeletionSubject, string> = {
  self: "A church needs at least one church admin, so add another before deleting your account.",
  other: "A church needs at least one church admin, so add another before deleting this account.",
};

export const PLATFORM_OPERATOR_MESSAGE: Record<DeletionSubject, string> = {
  self: "A platform operator's account can't be deleted here. Remove your operator access first.",
  other: "A platform operator's account can't be deleted here. Their operator access has to be removed first.",
};

/** A 409 from either delete route says which refusal it is. */
export function refusalMessage(error: unknown, subject: DeletionSubject): string | undefined {
  if (error === "last_church_admin") return LAST_CHURCH_ADMIN_MESSAGE[subject];
  if (error === "platform_operator") return PLATFORM_OPERATOR_MESSAGE[subject];
  return undefined;
}

export function photosNotRemovedMessage(count: number, subject: DeletionSubject): string {
  const photos = count === 1 ? "1 photo is" : `${count} photos are`;
  return subject === "self"
    ? `Your account is deleted, but ${photos} still stored. Ask your church admin to have them removed.`
    : `The account is deleted, but ${photos} still stored and need removing by hand.`;
}

export const DOWNLOAD_COVERS =
  "The file holds your profile, household, groups, RSVPs, serving turns, prayer requests, the funds you receive and your feedback.";

export const DOWNLOAD_LEAVES_OUT =
  "It doesn't include your photo, prayers you responded to, funds you're second on, or anything you added for a group, like events and announcements.";

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

const RETIRED = "retired until a leader checks its payment methods and reopens it";

function counted(count: number, one: string, many: string): string {
  return count === 1 ? `1 ${one}` : `${count} ${many}`;
}

function fundsAndGroups(content: DeletionGroupContent): { goes: string[]; stays: string[] } {
  if (content.kind === "names") {
    return {
      goes: content.fundsDeleted.map((f) => `The ${f.name} fund in ${f.group}, and its payment methods`),
      stays: [
        ...content.fundsRetired.map((f) => `The ${f.name} fund in ${f.group}, which goes to ${f.recipient}, ${RETIRED}`),
        ...content.groupsLosingLeader.map((g) => `${g}, with no leader until a church admin adds one`),
      ],
    };
  }
  return {
    goes: content.fundsDeleted
      ? [`${counted(content.fundsDeleted, "fund they receive, and its", "funds they receive, and their")} payment methods`]
      : [],
    stays: [
      ...(content.fundsRetired
        ? [
            `${counted(content.fundsRetired, "fund they receive, which goes", "funds they receive, which go")} to the second person, ${
              content.fundsRetired === 1 ? RETIRED : "retired until a leader checks their payment methods and reopens them"
            }`,
          ]
        : []),
      ...(content.groupsLosingLeader
        ? [`${counted(content.groupsLosingLeader, "group", "groups")} with no leader until a church admin adds one`]
        : []),
    ],
  };
}

/** What the confirmation says goes and stays, worded for the person acting. */
export function deletionCopy(summary: DeletionSummary, subject: DeletionSubject): DeletionCopy {
  const self = subject === "self";
  const { household, groupContent } = summary;
  const content = fundsAndGroups(groupContent);

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
  goes.push(...content.goes);
  if (household && !household.shared) goes.push(householdGoes(household));

  const stays = [
    "Announcements, events and lessons, without the author's name",
    "Serving dates shared with someone else, which stay with that person",
    "Feedback already sent, without a name",
    ...content.stays,
  ];
  if (household?.shared) {
    stays.unshift(`The ${household.name} household, and everyone else's details in it`);
  }

  return self
    ? {
        title: "Delete your account?",
        description: `You can't undo this. Download your data first if you want a copy. ${DOWNLOAD_LEAVES_OUT}`,
        goes,
        stays,
        confirmLabel: "Delete my account",
        pendingLabel: "Deleting…",
      }
    : {
        title: `Delete ${summary.name}'s account?`,
        description: "This permanently deletes them from the church, and you can't undo it.",
        goes,
        stays,
        confirmLabel: "Delete account",
        pendingLabel: "Deleting…",
      };
}
