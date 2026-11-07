-- Client roles read every column of profiles except email. A row policy
-- cannot hide one column, so the hide setting holds only once the column
-- itself is unreadable: a person reads their own address through
-- get_own_email(), a church admin through admin_member_emails(), and everyone
-- else through profiles_directory. Insert and update grants are unchanged,
-- and policies may still reference email, since column privileges do not
-- apply to policy expressions.
--
-- ADD COLUMN adds nothing to a column-level grant, so a new column on this
-- table is unreadable until it is listed here.
revoke select on public.profiles from anon, authenticated;
grant select (id, role, phone, bio, approved_at, approved_by, created_at, first_name, last_name,
  preferred_name, avatar_url, phone_mobile, phone_home, phone_work, address_line1, address_line2,
  city, state, postal_code, birth_month, birth_day, birth_year, anniversary, occupation, employer,
  family_id, is_unlisted, hide_phone_mobile, hide_phone_home, hide_phone_work, hide_email,
  hide_address, hide_birthday, hide_anniversary, hide_occupation, updated_at, relationship,
  hide_birth_year, setup_completed, email_announcements, org_id, email_event_reminders)
  on public.profiles to anon, authenticated;
