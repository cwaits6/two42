export type UserRole = "pending" | "member" | "content_editor" | "admin";

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
  anniversary: string | null;
  occupation: string | null;
  employer: string | null;
  family_id: string | null;
  is_unlisted: boolean;
  hide_phone_mobile: boolean;
  hide_phone_home: boolean;
  hide_phone_work: boolean;
  hide_email: boolean;
  hide_address: boolean;
  hide_birthday: boolean;
  hide_anniversary: boolean;
  hide_occupation: boolean;
  hide_birth_year: boolean;
  relationship: FamilyMemberRelationship;
  email_announcements: boolean;
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
  anniversary: string | null;
  hide_address: boolean;
  hide_phone_home: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Directory projection of a profile with privacy flags applied — hidden
 * fields come back as null. Queried from the `profiles_directory` view.
 * Admins should query the raw `profiles` table to bypass privacy.
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
  anniversary: string | null;
  occupation: string | null;
  employer: string | null;
  groups: GroupChip[];
  created_at: string;
}

export interface DirectoryFamily {
  id: string;
  family_name: string;
  photo_url: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  phone_home: string | null;
  anniversary: string | null;
  created_at: string;
  updated_at: string;
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

export interface EventCalendar {
  id: string;
  name: string;
  color: string | null;
  created_by: string | null;
  created_at: string;
}

export interface Event {
  id: string;
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
  series_occurrence_date: string | null; // the original occurrence ISO date this row replaces
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
  created_at: string;
}

export interface Announcement {
  id: string;
  title: string;
  content: string;
  is_published: boolean;
  author_id: string | null;
  published_at: string | null;
  created_at: string;
}

export interface Lecture {
  id: string;
  title: string;
  description: string | null;
  video_url: string;
  thumbnail_url: string | null;
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

/** An admin-defined member group; names and roles vary per deployment */
export interface MemberGroup {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  icon: string | null;
  display_order: number;
  show_in_directory_filter: boolean;
  /** Listed on the Serve page as a standing role/team (vs. a directory-only tag) */
  is_serving_role: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
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

/** Per-group serving signup configuration */
export interface ServingTeamSettings {
  group_id: string;
  enabled: boolean;
  /** Days of week to send reminders (0=Sunday .. 6=Saturday) */
  reminder_days: number[];
  reminder_method: "email";
  /** How many upcoming Sundays to show / email about */
  window_weeks: number;
  updated_by: string | null;
  updated_at: string;
}

/** One covered Sunday for one serving team */
export interface ServingSignup {
  id: string;
  group_id: string;
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
  group_id: string;
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
  birth_year: number | null;
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
  anniversary: string | null;
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

/** One giving collection, held by a named steward (optionally a couple) */
export interface GivingFund {
  id: string;
  name: string;
  description: string | null;
  /** Person who receives the money */
  steward_id: string;
  /** Displayed alongside the steward (couples) */
  co_steward_id: string | null;
  /** Short trust label: "Class treasurers", "Hospitality" */
  steward_role: string | null;
  /** YYYY-MM-DD — fund disappears from the Give page after this date */
  retire_on: string | null;
  is_active: boolean;
  display_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** A payment method a fund accepts */
export interface GivingFundMethod {
  fund_id: string;
  method: PaymentMethodKey;
  custom_handle: string;
  display_order: number;
}

export type PrayerCategory =
  | "health"
  | "family"
  | "thanksgiving"
  | "prodigal"
  | "guidance"
  | "grief";

/**
 * Row from the prayer_wall view. Author name/avatar come back null on
 * anonymous posts (unless it's the caller's own post — `mine` is true), and
 * warrior-restricted rows are filtered out by RLS for members who aren't
 * prayer warriors.
 */
export interface PrayerWallRow {
  id: string;
  body: string;
  category: PrayerCategory;
  is_anonymous: boolean;
  visible_to_warriors: boolean;
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

/** One weekly prayer call session shown on the Prayer Call card */
export interface PrayerCallSession {
  id: string;
  /** 0 = Sunday … 6 = Saturday */
  weekday: number;
  /** "HH:MM:SS" from Postgres time */
  start_time: string;
  end_time: string | null;
  leader_id: string | null;
  dial_in: string | null;
  pin: string | null;
  join_url: string | null;
  /** The synced weekly recurring calendar event, kept in step on save */
  event_id: string | null;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export interface SiteSetting {
  key: string;
  value: string | null;
  updated_by: string | null;
  updated_at: string | null;
  is_public: boolean;
}

/**
 * Singleton row (id = true) holding the About Our Class summary. Body is
 * BlockNote JSON. Members-only via RLS.
 */
export interface AboutPage {
  id: boolean;
  body: string;
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
