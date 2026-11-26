// The parts of leading a group that a leader can give to a member. Mirrors the
// check constraint on group_member_abilities.ability; the database decides
// every write, and these only decide what the app offers.

export const GROUP_ABILITIES = ["members", "calendar", "announcements", "lessons", "teams", "prayer_care"] as const;

export type GroupAbility = (typeof GROUP_ABILITIES)[number];

/** Only Prayer care can be linked to a team; see team_abilities in the schema. */
export const TEAM_ABILITIES = ["prayer_care"] as const satisfies readonly GroupAbility[];

export const ABILITY_COPY: Record<GroupAbility, { label: string; description: string }> = {
  members: {
    label: "Manage members",
    description: "Add and remove members, answer requests to join, and make invite links.",
  },
  calendar: {
    label: "Manage calendar",
    description: "Add, edit and delete events.",
  },
  announcements: {
    label: "Post announcements",
    description: "Write, publish and delete announcements.",
  },
  lessons: {
    label: "Manage lessons",
    description: "Add, edit and delete lessons and series.",
  },
  teams: {
    label: "Manage teams",
    description: "Add teams, choose team leads and manage serving.",
  },
  prayer_care: {
    label: "Prayer care",
    description: "Edit or delete any prayer request or comment.",
  },
};

export function isGroupAbility(value: string): value is GroupAbility {
  return (GROUP_ABILITIES as readonly string[]).includes(value);
}

/** A leader can do everything; anyone else only what they were given. */
export function can(
  group: { role: "leader" | "member"; abilities?: readonly GroupAbility[] },
  ability: GroupAbility,
): boolean {
  return group.role === "leader" || (group.abilities ?? []).includes(ability);
}

/** Whether a member holds any part of the leader's job, so the group's settings are worth showing. */
export function canManageAnything(group: { role: "leader" | "member"; abilities?: readonly GroupAbility[] }): boolean {
  return group.role === "leader" || (group.abilities ?? []).length > 0;
}
