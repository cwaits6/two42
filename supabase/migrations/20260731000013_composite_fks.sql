-- Composite foreign keys.
-- Every FK whose parent is an org-owned table becomes (fk_col, org_id) →
-- parent (id, org_id), so a child can never reference a parent in another
-- org — the database enforces same-tenant referential integrity instead of
-- application discipline.
--
-- Each constraint KEEPS its original name (drop + re-add): PostgREST embed
-- hints in the app reference these names (e.g.
-- `profiles!giving_funds_steward_id_fkey`), so renaming them would break
-- queries. Same relationship, stronger key. (Deviation from the plan's
-- `<child>_<fk>_org_fkey` naming, recorded in the PR.)
--
-- FK columns are MATCH SIMPLE: a NULL fk column skips the check entirely
-- (org_id is NOT NULL everywhere), so optional references stay optional.
--
-- ON DELETE SET NULL uses PG15's column-list form `set null (<col>)` — the
-- bare form would try to null org_id too, which is NOT NULL, so deleting
-- the parent would fail at runtime. This migration creates 15 of them: the
-- 7 capability/entity references below, plus the 8 attribution references
-- starting at "Attribution columns whose parent is public.profiles".
-- tenancy_fk_suite.sql proves org_id survives the delete for the first 7
-- only; the other 8 are currently unguarded (schema_tenancy_lint.sql
-- asserts compositeness, not the SET NULL column list). See the FK suite
-- header for the coverage boundary.
--
-- Left alone by design: FKs to auth.users (no org_id there); the
-- org_id → organizations FKs themselves; organization_members.profile_id →
-- profiles (the membership org is deliberately independent of the profile's
-- pinned org — that independence is the platform-admin / multi-org seam
-- platform-admin work builds on, and the fixture stub depends on it today).

-- ── Cascade set ─────────────────────────────────────────────────────────────

alter table public.calendar_subscription_tokens
  drop constraint calendar_subscription_tokens_user_id_fkey,
  add constraint calendar_subscription_tokens_user_id_fkey
    foreign key (user_id, org_id) references public.profiles (id, org_id) on delete cascade;

alter table public.class_teachers
  drop constraint class_teachers_profile_id_fkey,
  add constraint class_teachers_profile_id_fkey
    foreign key (profile_id, org_id) references public.profiles (id, org_id) on delete cascade;

alter table public.events
  drop constraint events_series_id_fkey,
  add constraint events_series_id_fkey
    foreign key (series_id, org_id) references public.events (id, org_id) on delete cascade;

alter table public.family_invites
  drop constraint family_invites_family_id_fkey,
  add constraint family_invites_family_id_fkey
    foreign key (family_id, org_id) references public.family_units (id, org_id) on delete cascade;

alter table public.family_invites
  drop constraint family_invites_family_member_id_fkey,
  add constraint family_invites_family_member_id_fkey
    foreign key (family_member_id, org_id) references public.family_members (id, org_id) on delete cascade;

alter table public.family_members
  drop constraint family_members_family_id_fkey,
  add constraint family_members_family_id_fkey
    foreign key (family_id, org_id) references public.family_units (id, org_id) on delete cascade;

alter table public.giving_fund_methods
  drop constraint giving_fund_methods_fund_id_fkey,
  add constraint giving_fund_methods_fund_id_fkey
    foreign key (fund_id, org_id) references public.giving_funds (id, org_id) on delete cascade;

alter table public.giving_funds
  drop constraint giving_funds_steward_id_fkey,
  add constraint giving_funds_steward_id_fkey
    foreign key (steward_id, org_id) references public.profiles (id, org_id) on delete cascade;

alter table public.prayer_requests
  drop constraint prayer_requests_author_id_fkey,
  add constraint prayer_requests_author_id_fkey
    foreign key (author_id, org_id) references public.profiles (id, org_id) on delete cascade;

alter table public.prayer_responses
  drop constraint prayer_responses_request_id_fkey,
  add constraint prayer_responses_request_id_fkey
    foreign key (request_id, org_id) references public.prayer_requests (id, org_id) on delete cascade;

alter table public.prayer_responses
  drop constraint prayer_responses_profile_id_fkey,
  add constraint prayer_responses_profile_id_fkey
    foreign key (profile_id, org_id) references public.profiles (id, org_id) on delete cascade;

alter table public.profile_groups
  drop constraint profile_groups_group_id_fkey,
  add constraint profile_groups_group_id_fkey
    foreign key (group_id, org_id) references public.member_groups (id, org_id) on delete cascade;

alter table public.profile_groups
  drop constraint profile_groups_profile_id_fkey,
  add constraint profile_groups_profile_id_fkey
    foreign key (profile_id, org_id) references public.profiles (id, org_id) on delete cascade;

alter table public.rsvps
  drop constraint rsvps_event_id_fkey,
  add constraint rsvps_event_id_fkey
    foreign key (event_id, org_id) references public.events (id, org_id) on delete cascade;

alter table public.rsvps
  drop constraint rsvps_user_id_fkey,
  add constraint rsvps_user_id_fkey
    foreign key (user_id, org_id) references public.profiles (id, org_id) on delete cascade;

alter table public.serving_broadcasts
  drop constraint serving_broadcasts_group_id_fkey,
  add constraint serving_broadcasts_group_id_fkey
    foreign key (group_id, org_id) references public.member_groups (id, org_id) on delete cascade;

alter table public.serving_signup_attendees
  drop constraint serving_signup_attendees_signup_id_fkey,
  add constraint serving_signup_attendees_signup_id_fkey
    foreign key (signup_id, org_id) references public.serving_signups (id, org_id) on delete cascade;

alter table public.serving_signup_attendees
  drop constraint serving_signup_attendees_profile_id_fkey,
  add constraint serving_signup_attendees_profile_id_fkey
    foreign key (profile_id, org_id) references public.profiles (id, org_id) on delete cascade;

alter table public.serving_signups
  drop constraint serving_signups_group_id_fkey,
  add constraint serving_signups_group_id_fkey
    foreign key (group_id, org_id) references public.member_groups (id, org_id) on delete cascade;

alter table public.serving_signups
  drop constraint serving_signups_created_by_fkey,
  add constraint serving_signups_created_by_fkey
    foreign key (created_by, org_id) references public.profiles (id, org_id) on delete cascade;

alter table public.serving_team_settings
  drop constraint serving_team_settings_group_id_fkey,
  add constraint serving_team_settings_group_id_fkey
    foreign key (group_id, org_id) references public.member_groups (id, org_id) on delete cascade;

-- ── The 7 capability/entity ON DELETE SET NULL references ───────────────────
-- These are the SET NULL relations tenancy_fk_suite.sql exercises one by
-- one; the 8 attribution ones further down use the same column-list form
-- but have no runtime test.

-- 1. An invite must not resolve a signup into another org's household.
alter table public.access_requests
  drop constraint access_requests_invite_token_fkey,
  add constraint access_requests_invite_token_fkey
    foreign key (invite_token, org_id) references public.family_invites (token, org_id)
    on delete set null (invite_token);

-- 2. An event filed under another org's calendar.
alter table public.events
  drop constraint events_calendar_id_fkey,
  add constraint events_calendar_id_fkey
    foreign key (calendar_id, org_id) references public.event_calendars (id, org_id)
    on delete set null (calendar_id);

-- 3. A lecture filed under another org's series.
alter table public.lectures
  drop constraint lectures_series_id_fkey,
  add constraint lectures_series_id_fkey
    foreign key (series_id, org_id) references public.lecture_series (id, org_id)
    on delete set null (series_id);

-- 4. A prayer call bound to another org's event.
alter table public.prayer_call_sessions
  drop constraint prayer_call_sessions_event_id_fkey,
  add constraint prayer_call_sessions_event_id_fkey
    foreign key (event_id, org_id) references public.events (id, org_id)
    on delete set null (event_id);

-- 5. A person placed in another org's household — the worst of the seven.
alter table public.profiles
  drop constraint profiles_family_id_fkey,
  add constraint profiles_family_id_fkey
    foreign key (family_id, org_id) references public.family_units (id, org_id)
    on delete set null (family_id);

-- 6. A serving slot attributed to another org's household.
alter table public.serving_signups
  drop constraint serving_signups_family_id_fkey,
  add constraint serving_signups_family_id_fkey
    foreign key (family_id, org_id) references public.family_units (id, org_id)
    on delete set null (family_id);

-- 7. Co-steward is a capability: it grants fund management.
alter table public.giving_funds
  drop constraint giving_funds_co_steward_id_fkey,
  add constraint giving_funds_co_steward_id_fkey
    foreign key (co_steward_id, org_id) references public.profiles (id, org_id)
    on delete set null (co_steward_id);

-- ── The 8 attribution ON DELETE SET NULL references (parent: profiles) ─────
-- Lower risk (they render a name, they don't grant access) but composite is
-- cheap in the same migration. FKs referencing auth.users stay single-column.
--
-- These use the same `set null (<col>)` column-list form as the 7 above and
-- break the same way if it is dropped, but no pgTAP test exercises them —
-- rewriting one as a bare `on delete set null` keeps CI green and fails in
-- production on the first delete of the referenced profile.

alter table public.announcements
  drop constraint announcements_author_id_fkey,
  add constraint announcements_author_id_fkey
    foreign key (author_id, org_id) references public.profiles (id, org_id)
    on delete set null (author_id);

alter table public.event_calendars
  drop constraint event_calendars_created_by_fkey,
  add constraint event_calendars_created_by_fkey
    foreign key (created_by, org_id) references public.profiles (id, org_id)
    on delete set null (created_by);

alter table public.events
  drop constraint events_created_by_fkey,
  add constraint events_created_by_fkey
    foreign key (created_by, org_id) references public.profiles (id, org_id)
    on delete set null (created_by);

alter table public.feedback
  drop constraint feedback_profile_id_fkey,
  add constraint feedback_profile_id_fkey
    foreign key (profile_id, org_id) references public.profiles (id, org_id)
    on delete set null (profile_id);

alter table public.giving_funds
  drop constraint giving_funds_created_by_fkey,
  add constraint giving_funds_created_by_fkey
    foreign key (created_by, org_id) references public.profiles (id, org_id)
    on delete set null (created_by);

alter table public.lectures
  drop constraint lectures_created_by_fkey,
  add constraint lectures_created_by_fkey
    foreign key (created_by, org_id) references public.profiles (id, org_id)
    on delete set null (created_by);

alter table public.prayer_call_sessions
  drop constraint prayer_call_sessions_leader_id_fkey,
  add constraint prayer_call_sessions_leader_id_fkey
    foreign key (leader_id, org_id) references public.profiles (id, org_id)
    on delete set null (leader_id);

alter table public.serving_broadcasts
  drop constraint serving_broadcasts_sent_by_fkey,
  add constraint serving_broadcasts_sent_by_fkey
    foreign key (sent_by, org_id) references public.profiles (id, org_id)
    on delete set null (sent_by);
