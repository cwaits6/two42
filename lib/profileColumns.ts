import type { Profile } from "@/lib/types";

/**
 * Every column the app reads off a profile row except the address. Client
 * roles cannot read profiles.email; an address comes from get_own_email(),
 * admin_member_emails() or profiles_directory.
 */
export const PROFILE_COLUMNS =
  "id, first_name, last_name, preferred_name, role, avatar_url, phone, phone_mobile, phone_home, phone_work, bio, address_line1, address_line2, city, state, postal_code, birth_month, birth_day, birth_year, occupation, employer, family_id, is_unlisted, hide_email, relationship, email_announcements, email_event_reminders, setup_completed, approved_at, approved_by, created_at, updated_at";

export type ProfileColumns = Omit<Profile, "email">;

/** One row of admin_member_emails(). */
export interface MemberEmail {
  profile_id: string;
  email: string | null;
}

export function withEmail(row: ProfileColumns, email: string | null): Profile {
  return { ...row, email };
}
