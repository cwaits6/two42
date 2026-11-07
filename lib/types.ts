import type { Tables } from "@/lib/supabase/database.types";

export type UserRole = "pending" | "member" | "admin";

export type AccessRequestStatus = "pending" | "approved" | "denied";

export type RsvpStatus = "yes" | "no" | "maybe";

export interface Profile {
  id: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  role: UserRole;
  avatar_url: string | null;
  email: string | null;
  phone: string | null;
  phone_mobile: string | null;
  phone_home: string | null;
  phone_work: string | null;
  bio: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  birth_month: number | null;
  birth_day: number | null;
  birth_year: number | null;
  occupation: string | null;
  employer: string | null;
  family_id: string | null;
  is_unlisted: boolean;
  hide_email: boolean;
  relationship: FamilyMemberRelationship;
  email_announcements: boolean;
  /** Event reminder emails; only the person changes it. */
  email_event_reminders: boolean;
  setup_completed: boolean;
  approved_at: string | null;
  approved_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface FamilyUnit {
  id: string;
  family_name: string;
  photo_url: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  phone_home: string | null;
  /** The spouse whose mobile is the household phone; phone_home is null while set. */
  phone_profile_id: string | null;
  anniversary_month: number | null;
  anniversary_day: number | null;
  anniversary_year: number | null;
  created_at: string;
  updated_at: string;
}

/**
 * Directory projection of a profile — a hidden email comes back as null.
 * Queried from the `profiles_directory` view.
 */
export interface DirectoryProfile {
  id: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  avatar_url: string | null;
  role: UserRole;
  relationship: FamilyMemberRelationship;
  bio: string | null;
  family_id: string | null;
  email: string | null;
  phone_mobile: string | null;
  phone_home: string | null;
  phone_work: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  birth_month: number | null;
  birth_day: number | null;
  birth_year: number | null;
  occupation: string | null;
  employer: string | null;
  groups: GroupChip[];
  created_at: string;
}

export interface AccessRequest {
  id: string;
  name: string;
  email: string;
  message: string | null;
  status: AccessRequestStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  signup_token: string | null;
  token_expires_at: string | null;
  created_at: string;
}

/** A member's request for a new group under the approval policy. */
export interface GroupRequest {
  id: string;
  org_id: string;
  requested_by: string;
  name: string;
  description: string | null;
  status: "pending" | "approved" | "declined";
  reviewed_by: string | null;
  reviewed_at: string | null;
  group_id: string | null;
  created_at: string;
}

/** A link into one group; dead once revoked, expired or used max_uses times. */
export type GroupInvite = Tables<"group_invites">;

/** A group's calendar. One per group in practice; its color is the group's color. */
export interface EventCalendar {
  id: string;
  group_id: string;
  name: string;
  color: string | null;
  created_by: string | null;
  created_at: string;
}

export interface Event {
  id: string;
  group_id: string;
  title: string;
  description: string | null;
  location: string | null;
  start_time: string;
  end_time: string | null;
  calendar_id: string | null;
  is_rsvp_enabled: boolean;
  created_by: string | null;
  created_at: string;
  // Recurrence metadata (Apple/ICS style — one row per series, expanded at render time)
  recurrence_frequency: "daily" | "weekly" | "monthly" | "yearly" | null;
  recurrence_interval: number;
  recurrence_end_mode: "never" | "count" | "until" | null;
  recurrence_count: number | null;
  recurrence_until: string | null;
  // Per-occurrence exception support
  series_id: string | null;           // set on exception events; points to the anchor series
  // This event's or series' choice of what calendar subscriptions carry;
  // null follows the group's setting. Exception rows follow their series.
  calendar_meeting_details: boolean | null;
  calendar_event_notes: boolean | null;
  calendar_event_location: boolean | null;
  /** Days before the start that the reminder goes out; 0 sends none. A moved date follows its series. */
  reminder_days_before: number;
  series_occurrence_date: string | null; // the original occurrence ISO date this row replaces
  is_cancelled: boolean;                 // an exception row that removes its date instead of replacing it
  // Meeting / video call (set on the series anchor; exceptions inherit)
  meeting_url: string | null;
  meeting_id: string | null;
  meeting_passcode: string | null;
  meeting_show_on_dashboard: boolean;
  meeting_lead_minutes: number;
}

export interface Rsvp {
  id: string;
  event_id: string;
  user_id: string;
  status: RsvpStatus;
  /** The date's calendar day in the church's zone; null covers every date. */
  occurrence_date: string | null;
  created_at: string;
}

export interface Announcement {
  id: string;
  group_id: string;
  title: string;
  content: string;
  is_published: boolean;
  author_id: string | null;
  published_at: string | null;
  created_at: string;
}

export interface Lecture {
  id: string;
  group_id: string;
  title: string;
  description: string | null;
  video_url: string;
  lecture_date: string | null;
  created_by: string | null;
  created_at: string;
}

export type FamilyMemberRelationship =
  | "primary"
  | "spouse"
  | "child"
  | "parent"
  | "sibling"
  | "other";

/** Lightweight non-auth family member (children, non-attending spouses, etc.) */
export interface FamilyMember {
  id: string;
  family_id: string;
  first_name: string;
  last_name: string | null;
  preferred_name: string | null;
  birth_month: number | null;
  birth_day: number | null;
  birth_year: number | null;
  relationship: FamilyMemberRelationship;
  avatar_url: string | null;
  is_class_member: boolean;
  claimed_profile_id: string | null;
  created_at: string;
  updated_at: string;
}

/** A team inside one group; names and roles vary per deployment */
export interface MemberGroup {
  id: string;
  /** The group this team belongs to */
  group_id: string;
  name: string;
  description: string | null;
  color: string | null;
  icon: string | null;
  display_order: number;
  /** Listed on the Serve page as a standing role/team */
  is_serving_role: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** A filter defined inside one group and applied to a group membership, never to the person */
export interface GroupLabel {
  id: string;
  group_id: string;
  name: string;
  color: string | null;
  created_at: string;
}

/** Join record linking a profile to a member group */
export interface ProfileGroup {
  profile_id: string;
  group_id: string;
  assigned_by: string | null;
  assigned_at: string;
  /** Leader of this group only — no global leader role */
  is_leader: boolean;
}

/** Per-team serving signup configuration */
export interface ServingTeamSettings {
  team_id: string;
  enabled: boolean;
  /** Days of week to send reminders (0=Sunday .. 6=Saturday) */
  reminder_days: number[];
  reminder_method: "email";
  /** Rolling: the next window_weeks Sundays. Set: the Sundays from date_from to date_to. */
  schedule: "rolling" | "set";
  /** How many upcoming Sundays to show / email about, on a rolling schedule */
  window_weeks: number;
  date_from: string | null;
  date_to: string | null;
  /** How many following weeks a sign-up offers in one go, 0 to 3 */
  extra_weeks: number;
  /** Whole hour in the church's time zone the reminder goes out, or null for the default */
  send_hour: number | null;
  updated_by: string | null;
  updated_at: string;
}

/** One covered Sunday for one serving team */
export interface ServingSignup {
  id: string;
  team_id: string;
  /** YYYY-MM-DD */
  service_date: string;
  family_id: string | null;
  created_by: string;
  created_at: string;
}

export interface ServingSignupAttendee {
  signup_id: string;
  profile_id: string;
}

/** Log entry for a leader "Email the team" send */
export interface ServingBroadcast {
  id: string;
  team_id: string;
  sent_by: string | null;
  subject: string;
  open_dates: string[];
  recipient_count: number;
  created_at: string;
}

/** Minimal group info embedded in directory views */
export interface GroupChip {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
}

/** Member entry within a families_directory_full household row */
export interface HouseholdMember {
  id: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  avatar_url: string | null;
  relationship: FamilyMemberRelationship;
  is_class_member: boolean;
  phone_mobile: string | null;
  birth_month: number | null;
  birth_day: number | null;
  birth_year: number | null;
}

/** Family member entry (non-auth) within a families_directory_full row */
export interface HouseholdFamilyMember {
  id: string;
  first_name: string;
  last_name: string | null;
  preferred_name: string | null;
  avatar_url: string | null;
  relationship: FamilyMemberRelationship;
  is_class_member: boolean;
  birth_month: number | null;
  birth_day: number | null;
  claimed_profile_id: string | null;
}

/**
 * Full household row from families_directory_full view.
 * Includes aggregated members (profiles) and family_members_list (non-auth).
 */
export interface FamilyDirectoryFull {
  id: string;
  family_name: string;
  photo_url: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  phone_home: string | null;
  /** The spouse whose mobile `phone_home` reads through; named in `members`. */
  phone_profile_id: string | null;
  anniversary_month: number | null;
  anniversary_day: number | null;
  anniversary_year: number | null;
  created_at: string;
  updated_at: string;
  members: HouseholdMember[];
  family_members_list: HouseholdFamilyMember[];
}

/** Family invite record — links a family_members row to a pending account creation */
export interface FamilyInvite {
  id: string;
  family_member_id: string;
  family_id: string;
  invite_email: string;
  token: string;
  sent_at: string | null;
  accepted_at: string | null;
  created_by: string | null;
  created_at: string;
}

export type PaymentMethodKey =
  | "venmo"
  | "paypal"
  | "cashapp"
  | "zelle"
  | "wallet";

/** One giving collection, held by a named recipient and optionally a second person */
export type GivingFund = Tables<"giving_funds">;

/** A payment method a fund accepts */
export interface GivingFundMethod {
  fund_id: string;
  group_id: string;
  method: PaymentMethodKey;
  custom_handle: string;
  display_order: number;
}

/**
 * Row from the prayer_wall view. Author name/avatar come back null on
 * anonymous posts (unless it's the caller's own post — `mine` is true).
 */
export interface PrayerWallRow {
  id: string;
  group_id: string;
  body: string;
  is_anonymous: boolean;
  is_answered: boolean;
  created_at: string;
  mine: boolean;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  avatar_url: string | null;
  praying_count: number;
  i_am_praying: boolean;
}

export interface SiteSetting {
  key: string;
  value: string | null;
  updated_by: string | null;
  updated_at: string | null;
  is_public: boolean;
}

/**
 * One row per group holding the About page summary. Body is BlockNote
 * JSON. Group members only via RLS.
 */
export interface AboutPage {
  group_id: string;
  body: string;
  updated_by: string | null;
  updated_at: string;
}

/**
 * Per-group settings. An absent row means the defaults; the first save
 * upserts on the group_id key.
 */
export interface GroupSettings {
  group_id: string;
  serving_link_mode: "signed" | "login" | null;
  /** Calendar subscriptions carry meeting links, IDs and passcodes; off, they link to the event page. */
  calendar_meeting_details: boolean;
  /** Calendar subscriptions carry event descriptions; off, they link to the event page. */
  calendar_event_notes: boolean;
  /** Calendar subscriptions carry event locations; off, they link to the event page. */
  calendar_event_location: boolean;
  /** Off sends no event reminders for the group; each event keeps its choice. */
  event_reminders_enabled: boolean;
  /** What Add event starts on: 1, 2 or 7 days before. */
  event_reminder_default_days: number;
  updated_by: string | null;
  updated_at: string;
}

/**
 * A teacher listed on the About Our Class page. Points at a member profile
 * (name and photo come from the profile) with a teacher-specific title and
 * bio on top.
 */
export interface ClassTeacher {
  id: string;
  group_id: string;
  profile_id: string;
  title: string;
  bio: string;
  sort_order: number;
  created_at: string;
}

/** ClassTeacher with the joined profile fields used for display. */
export interface ClassTeacherWithProfile extends ClassTeacher {
  profiles: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    preferred_name: string | null;
    avatar_url: string | null;
  } | null;
}
