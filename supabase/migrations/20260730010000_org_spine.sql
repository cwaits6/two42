-- Tenancy org spine.
-- Adds organizations columns + platform_admins, tags all 28 tenant tables
-- with org_id (fail-closed default, backfilled to one synthetic org),
-- re-scopes 4 tables' PK/uniques, re-adds member_groups.functional_role.
-- No real church/member data is seeded — the default org below is
-- synthetic. Production behavior is unchanged: existing RLS
-- policies are not modified by this migration; the RLS rewrite that
-- follows owns that.

-- app_current_org_id() below reads profiles.org_id, a column this same
-- migration adds later (the function must exist first so the org_id
-- columns can reference it as their DEFAULT). Skip body validation at
-- CREATE time; the body is exercised by the pgTAP suite and the
-- fail-closed smoke check.
set check_function_bodies = off;

-- 1. Extend the scaffold's organizations table (do NOT re-create it).
alter table public.organizations
  add column slug text,
  add column branding jsonb not null default '{}'::jsonb,
  add column status text not null default 'active';

alter table public.organizations
  add constraint organizations_status_check check (status in ('active', 'suspended'));

update public.organizations set slug = 'default' where slug is null;
alter table public.organizations alter column slug set not null;
alter table public.organizations add constraint organizations_slug_key unique (slug);

-- Synthetic default org. NEVER a real church/member identity.
-- Constant id referenced by every table's backfill below.
insert into public.organizations (id, slug, name, branding, status)
values ('00000000-0000-0000-0000-000000000001', 'default', 'Default Organization', '{}'::jsonb, 'active')
on conflict (id) do nothing;

-- 2. platform_admins: Two42-operator superusers, orthogonal to any org.
-- References auth.users directly (not profiles) since profiles is now
-- org-pinned and a platform admin isn't necessarily a member of any org.
create table public.platform_admins (
  profile_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.platform_admins enable row level security;

create or replace function public.is_platform_admin() returns boolean
  language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.platform_admins where profile_id = (select auth.uid()));
$$;

grant execute on function public.is_platform_admin() to anon, authenticated, service_role;

create policy "platform admins can view platform admins" on public.platform_admins
  for select using (( select public.is_platform_admin() ));
-- No insert/update/delete policy: bootstrapping a platform admin is a
-- migration/service-role-only operation, same treatment as
-- provision_organization() in the test harness scaffold.

-- 3. app_current_org_id(): resolves via profiles.org_id (NOT
-- organization_members). NULL when the caller has no
-- profile row (service-role, or the instant before handle_new_user()'s
-- own insert completes), which is exactly what makes
-- org_id NOT NULL DEFAULT this function fail-closed.
create or replace function public.app_current_org_id() returns uuid
  language sql stable security definer set search_path = ''
as $$
  select org_id from public.profiles where id = (select auth.uid());
$$;

grant execute on function public.app_current_org_id() to anon, authenticated, service_role;

set check_function_bodies = on;  -- re-enable: the only forward-reference is above

-- 4. org_id rollout. Per table: add nullable column, backfill to the
-- default org, set the fail-closed default, set NOT NULL, FK, index.
-- Never ADD COLUMN with the function default directly — the migration
-- role has no auth.uid(), so that would backfill every row to NULL and
-- fail the NOT NULL step.

alter table public.access_requests add column org_id uuid;
update public.access_requests set org_id = '00000000-0000-0000-0000-000000000001' where org_id is null;
alter table public.access_requests alter column org_id set default public.app_current_org_id();
alter table public.access_requests alter column org_id set not null;
alter table public.access_requests add constraint access_requests_org_id_fkey foreign key (org_id) references public.organizations(id) on delete cascade;
create index access_requests_org_id_idx on public.access_requests (org_id);

alter table public.announcements add column org_id uuid;
update public.announcements set org_id = '00000000-0000-0000-0000-000000000001' where org_id is null;
alter table public.announcements alter column org_id set default public.app_current_org_id();
alter table public.announcements alter column org_id set not null;
alter table public.announcements add constraint announcements_org_id_fkey foreign key (org_id) references public.organizations(id) on delete cascade;
create index announcements_org_id_idx on public.announcements (org_id);

alter table public.calendar_subscription_tokens add column org_id uuid;
update public.calendar_subscription_tokens set org_id = '00000000-0000-0000-0000-000000000001' where org_id is null;
alter table public.calendar_subscription_tokens alter column org_id set default public.app_current_org_id();
alter table public.calendar_subscription_tokens alter column org_id set not null;
alter table public.calendar_subscription_tokens add constraint calendar_subscription_tokens_org_id_fkey foreign key (org_id) references public.organizations(id) on delete cascade;
create index calendar_subscription_tokens_org_id_idx on public.calendar_subscription_tokens (org_id);

alter table public.event_calendars add column org_id uuid;
update public.event_calendars set org_id = '00000000-0000-0000-0000-000000000001' where org_id is null;
alter table public.event_calendars alter column org_id set default public.app_current_org_id();
alter table public.event_calendars alter column org_id set not null;
alter table public.event_calendars add constraint event_calendars_org_id_fkey foreign key (org_id) references public.organizations(id) on delete cascade;
create index event_calendars_org_id_idx on public.event_calendars (org_id);

alter table public.events add column org_id uuid;
update public.events set org_id = '00000000-0000-0000-0000-000000000001' where org_id is null;
alter table public.events alter column org_id set default public.app_current_org_id();
alter table public.events alter column org_id set not null;
alter table public.events add constraint events_org_id_fkey foreign key (org_id) references public.organizations(id) on delete cascade;
create index events_org_id_idx on public.events (org_id);

alter table public.family_units add column org_id uuid;
update public.family_units set org_id = '00000000-0000-0000-0000-000000000001' where org_id is null;
alter table public.family_units alter column org_id set default public.app_current_org_id();
alter table public.family_units alter column org_id set not null;
alter table public.family_units add constraint family_units_org_id_fkey foreign key (org_id) references public.organizations(id) on delete cascade;
create index family_units_org_id_idx on public.family_units (org_id);

alter table public.family_members add column org_id uuid;
update public.family_members set org_id = '00000000-0000-0000-0000-000000000001' where org_id is null;
alter table public.family_members alter column org_id set default public.app_current_org_id();
alter table public.family_members alter column org_id set not null;
alter table public.family_members add constraint family_members_org_id_fkey foreign key (org_id) references public.organizations(id) on delete cascade;
create index family_members_org_id_idx on public.family_members (org_id);

alter table public.family_invites add column org_id uuid;
update public.family_invites set org_id = '00000000-0000-0000-0000-000000000001' where org_id is null;
alter table public.family_invites alter column org_id set default public.app_current_org_id();
alter table public.family_invites alter column org_id set not null;
alter table public.family_invites add constraint family_invites_org_id_fkey foreign key (org_id) references public.organizations(id) on delete cascade;
create index family_invites_org_id_idx on public.family_invites (org_id);

alter table public.feedback add column org_id uuid;
update public.feedback set org_id = '00000000-0000-0000-0000-000000000001' where org_id is null;
alter table public.feedback alter column org_id set default public.app_current_org_id();
alter table public.feedback alter column org_id set not null;
alter table public.feedback add constraint feedback_org_id_fkey foreign key (org_id) references public.organizations(id) on delete cascade;
create index feedback_org_id_idx on public.feedback (org_id);

alter table public.giving_fund_methods add column org_id uuid;
update public.giving_fund_methods set org_id = '00000000-0000-0000-0000-000000000001' where org_id is null;
alter table public.giving_fund_methods alter column org_id set default public.app_current_org_id();
alter table public.giving_fund_methods alter column org_id set not null;
alter table public.giving_fund_methods add constraint giving_fund_methods_org_id_fkey foreign key (org_id) references public.organizations(id) on delete cascade;
create index giving_fund_methods_org_id_idx on public.giving_fund_methods (org_id);

alter table public.giving_funds add column org_id uuid;
update public.giving_funds set org_id = '00000000-0000-0000-0000-000000000001' where org_id is null;
alter table public.giving_funds alter column org_id set default public.app_current_org_id();
alter table public.giving_funds alter column org_id set not null;
alter table public.giving_funds add constraint giving_funds_org_id_fkey foreign key (org_id) references public.organizations(id) on delete cascade;
create index giving_funds_org_id_idx on public.giving_funds (org_id);

alter table public.lecture_series add column org_id uuid;
update public.lecture_series set org_id = '00000000-0000-0000-0000-000000000001' where org_id is null;
alter table public.lecture_series alter column org_id set default public.app_current_org_id();
alter table public.lecture_series alter column org_id set not null;
alter table public.lecture_series add constraint lecture_series_org_id_fkey foreign key (org_id) references public.organizations(id) on delete cascade;
create index lecture_series_org_id_idx on public.lecture_series (org_id);

alter table public.lectures add column org_id uuid;
update public.lectures set org_id = '00000000-0000-0000-0000-000000000001' where org_id is null;
alter table public.lectures alter column org_id set default public.app_current_org_id();
alter table public.lectures alter column org_id set not null;
alter table public.lectures add constraint lectures_org_id_fkey foreign key (org_id) references public.organizations(id) on delete cascade;
create index lectures_org_id_idx on public.lectures (org_id);

alter table public.prayer_call_sessions add column org_id uuid;
update public.prayer_call_sessions set org_id = '00000000-0000-0000-0000-000000000001' where org_id is null;
alter table public.prayer_call_sessions alter column org_id set default public.app_current_org_id();
alter table public.prayer_call_sessions alter column org_id set not null;
alter table public.prayer_call_sessions add constraint prayer_call_sessions_org_id_fkey foreign key (org_id) references public.organizations(id) on delete cascade;
create index prayer_call_sessions_org_id_idx on public.prayer_call_sessions (org_id);

alter table public.prayer_requests add column org_id uuid;
update public.prayer_requests set org_id = '00000000-0000-0000-0000-000000000001' where org_id is null;
alter table public.prayer_requests alter column org_id set default public.app_current_org_id();
alter table public.prayer_requests alter column org_id set not null;
alter table public.prayer_requests add constraint prayer_requests_org_id_fkey foreign key (org_id) references public.organizations(id) on delete cascade;
create index prayer_requests_org_id_idx on public.prayer_requests (org_id);

alter table public.prayer_responses add column org_id uuid;
update public.prayer_responses set org_id = '00000000-0000-0000-0000-000000000001' where org_id is null;
alter table public.prayer_responses alter column org_id set default public.app_current_org_id();
alter table public.prayer_responses alter column org_id set not null;
alter table public.prayer_responses add constraint prayer_responses_org_id_fkey foreign key (org_id) references public.organizations(id) on delete cascade;
create index prayer_responses_org_id_idx on public.prayer_responses (org_id);

alter table public.profile_groups add column org_id uuid;
update public.profile_groups set org_id = '00000000-0000-0000-0000-000000000001' where org_id is null;
alter table public.profile_groups alter column org_id set default public.app_current_org_id();
alter table public.profile_groups alter column org_id set not null;
alter table public.profile_groups add constraint profile_groups_org_id_fkey foreign key (org_id) references public.organizations(id) on delete cascade;
create index profile_groups_org_id_idx on public.profile_groups (org_id);

alter table public.rsvps add column org_id uuid;
update public.rsvps set org_id = '00000000-0000-0000-0000-000000000001' where org_id is null;
alter table public.rsvps alter column org_id set default public.app_current_org_id();
alter table public.rsvps alter column org_id set not null;
alter table public.rsvps add constraint rsvps_org_id_fkey foreign key (org_id) references public.organizations(id) on delete cascade;
create index rsvps_org_id_idx on public.rsvps (org_id);

alter table public.serving_broadcasts add column org_id uuid;
update public.serving_broadcasts set org_id = '00000000-0000-0000-0000-000000000001' where org_id is null;
alter table public.serving_broadcasts alter column org_id set default public.app_current_org_id();
alter table public.serving_broadcasts alter column org_id set not null;
alter table public.serving_broadcasts add constraint serving_broadcasts_org_id_fkey foreign key (org_id) references public.organizations(id) on delete cascade;
create index serving_broadcasts_org_id_idx on public.serving_broadcasts (org_id);

alter table public.serving_signup_attendees add column org_id uuid;
update public.serving_signup_attendees set org_id = '00000000-0000-0000-0000-000000000001' where org_id is null;
alter table public.serving_signup_attendees alter column org_id set default public.app_current_org_id();
alter table public.serving_signup_attendees alter column org_id set not null;
alter table public.serving_signup_attendees add constraint serving_signup_attendees_org_id_fkey foreign key (org_id) references public.organizations(id) on delete cascade;
create index serving_signup_attendees_org_id_idx on public.serving_signup_attendees (org_id);

alter table public.serving_signups add column org_id uuid;
update public.serving_signups set org_id = '00000000-0000-0000-0000-000000000001' where org_id is null;
alter table public.serving_signups alter column org_id set default public.app_current_org_id();
alter table public.serving_signups alter column org_id set not null;
alter table public.serving_signups add constraint serving_signups_org_id_fkey foreign key (org_id) references public.organizations(id) on delete cascade;
create index serving_signups_org_id_idx on public.serving_signups (org_id);

alter table public.serving_team_settings add column org_id uuid;
update public.serving_team_settings set org_id = '00000000-0000-0000-0000-000000000001' where org_id is null;
alter table public.serving_team_settings alter column org_id set default public.app_current_org_id();
alter table public.serving_team_settings alter column org_id set not null;
alter table public.serving_team_settings add constraint serving_team_settings_org_id_fkey foreign key (org_id) references public.organizations(id) on delete cascade;
create index serving_team_settings_org_id_idx on public.serving_team_settings (org_id);

-- profiles: same rollout, but upgrade the existing directory-listing index
-- to be org_id-leading rather than adding a redundant plain org_id index.
alter table public.profiles add column org_id uuid;
update public.profiles set org_id = '00000000-0000-0000-0000-000000000001' where org_id is null;
alter table public.profiles alter column org_id set default public.app_current_org_id();
alter table public.profiles alter column org_id set not null;
alter table public.profiles add constraint profiles_org_id_fkey foreign key (org_id) references public.organizations(id) on delete cascade;

drop index if exists public.profiles_last_first_idx;
create index profiles_org_id_last_first_idx on public.profiles (org_id, last_name, first_name);

-- 5. PK/unique re-scoping. Each keeps a temporary legacy global unique so
-- current app onConflict targets keep working while only one org exists;
-- the RLS rewrite drops them alongside the app upsert updates.

-- page_content: PK slug → (org_id, slug).
alter table public.page_content add column org_id uuid;
update public.page_content set org_id = '00000000-0000-0000-0000-000000000001' where org_id is null;
alter table public.page_content alter column org_id set default public.app_current_org_id();
alter table public.page_content alter column org_id set not null;
alter table public.page_content add constraint page_content_org_id_fkey foreign key (org_id) references public.organizations(id) on delete cascade;

alter table public.page_content drop constraint page_content_pkey;
alter table public.page_content add constraint page_content_pkey primary key (org_id, slug);
-- Temporary: preserves the pre-tenancy single-column uniqueness so any
-- code relying on slug alone being unique keeps working. Only one org
-- exists today, so this is not yet a real restriction. The RLS rewrite
-- drops it.
alter table public.page_content add constraint page_content_slug_legacy_key unique (slug);
-- No standalone org_id index: page_content_pkey (org_id, slug) already
-- serves org_id-only lookups via the leftmost-prefix rule (same treatment
-- as profiles above).

-- site_settings: PK key → (org_id, key).
alter table public.site_settings add column org_id uuid;
update public.site_settings set org_id = '00000000-0000-0000-0000-000000000001' where org_id is null;
alter table public.site_settings alter column org_id set default public.app_current_org_id();
alter table public.site_settings alter column org_id set not null;
alter table public.site_settings add constraint site_settings_org_id_fkey foreign key (org_id) references public.organizations(id) on delete cascade;

alter table public.site_settings drop constraint site_settings_pkey;
alter table public.site_settings add constraint site_settings_pkey primary key (org_id, key);
alter table public.site_settings add constraint site_settings_key_legacy_key unique (key);
-- No standalone org_id index: site_settings_pkey (org_id, key) already
-- serves org_id-only lookups via the leftmost-prefix rule.

-- class_teachers: PK stays id; UNIQUE(profile_id) → UNIQUE(org_id, profile_id),
-- old one kept (renamed) as the temporary legacy unique.
alter table public.class_teachers add column org_id uuid;
update public.class_teachers set org_id = '00000000-0000-0000-0000-000000000001' where org_id is null;
alter table public.class_teachers alter column org_id set default public.app_current_org_id();
alter table public.class_teachers alter column org_id set not null;
alter table public.class_teachers add constraint class_teachers_org_id_fkey foreign key (org_id) references public.organizations(id) on delete cascade;

alter table public.class_teachers rename constraint class_teachers_profile_id_key to class_teachers_profile_id_legacy_key;
alter table public.class_teachers add constraint class_teachers_org_id_profile_id_key unique (org_id, profile_id);
-- No standalone org_id index: class_teachers_org_id_profile_id_key
-- (org_id, profile_id) already serves org_id-only lookups via the
-- leftmost-prefix rule.

-- about_page: singleton; PK id (boolean CHECKed true) → (org_id, id).
alter table public.about_page add column org_id uuid;
update public.about_page set org_id = '00000000-0000-0000-0000-000000000001' where org_id is null;
alter table public.about_page alter column org_id set default public.app_current_org_id();
alter table public.about_page alter column org_id set not null;
alter table public.about_page add constraint about_page_org_id_fkey foreign key (org_id) references public.organizations(id) on delete cascade;

alter table public.about_page drop constraint about_page_pkey;
alter table public.about_page add constraint about_page_pkey primary key (org_id, id);
-- Legacy: id stays boolean CHECKed true, so this trivially still means
-- "at most one about_page row in the whole table" until the RLS rewrite
-- drops it.
alter table public.about_page add constraint about_page_id_legacy_key unique (id);
-- No standalone org_id index: about_page_pkey (org_id, id) already serves
-- org_id-only lookups via the leftmost-prefix rule.

-- member_groups: plain org_id rollout plus re-adding functional_role.
alter table public.member_groups add column org_id uuid;
update public.member_groups set org_id = '00000000-0000-0000-0000-000000000001' where org_id is null;
alter table public.member_groups alter column org_id set default public.app_current_org_id();
alter table public.member_groups alter column org_id set not null;
alter table public.member_groups add constraint member_groups_org_id_fkey foreign key (org_id) references public.organizations(id) on delete cascade;

create index member_groups_org_id_idx on public.member_groups (org_id);

-- Re-added because the real provision_organization() looks up specific
-- groups by this key. No
-- CHECK enum: the actual role names (prayer_warriors/serving_team/
-- leaders proposed) are an open item for the maintainer, not decided
-- here. Left NULL on all existing rows — assigning values is the real
-- provisioning migration's job.
alter table public.member_groups add column functional_role text;

create unique index member_groups_org_id_functional_role_key
  on public.member_groups (org_id, functional_role)
  where functional_role is not null;

-- 6. provision_organization(): the scaffold stub inserts organizations
-- rows with only a name, which now violates slug's NOT NULL. Still a
-- test/seed-only stub (EXECUTE stays revoked from anon/authenticated as
-- in the scaffold); a later migration replaces it with real provisioning.
-- Slug is derived from the name with a random suffix — fixture orgs only,
-- never a real identity.
-- Known limitation, intentional: this stub does NOT re-pin the owner's
-- profiles.org_id, so app_current_org_id() for the owner keeps resolving
-- to the org handle_new_user() stamped (the default org) — the leak suite
-- asserts exactly that. Fixture org membership flows through
-- organization_members / is_org_member() instead. Owner pinning belongs
-- to the real provisioning migration.
create or replace function public.provision_organization(_name text, _owner_id uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  _org_id uuid;
begin
  insert into public.organizations (name, slug)
  values (
    _name,
    lower(regexp_replace(_name, '[^a-zA-Z0-9]+', '-', 'g'))
      || '-' || left(gen_random_uuid()::text, 8)
  )
  returning id into _org_id;
  insert into public.organization_members (org_id, profile_id) values (_org_id, _owner_id);
  return _org_id;
end;
$$;

-- 7. handle_new_user(): stamp new signups into the default org explicitly.
-- The explicit org_id on the profiles INSERT bypasses the column DEFAULT,
-- breaking the app_current_org_id() chicken-and-egg for a user's own first
-- profile row. Interim version — the RLS rewrite replaces it
-- with a fail-closed version that resolves org from approved
-- access_requests/family_invites.
create or replace function public.handle_new_user() returns trigger
  language plpgsql security definer set search_path = ''
as $$
declare
  _role text := 'pending';
  _full_name text := new.raw_user_meta_data->>'full_name';
  _first text;
  _last text;
  _default_org_id uuid := '00000000-0000-0000-0000-000000000001';
begin
  if exists (
    select 1 from public.access_requests
    where email = new.email
      and status = 'approved'
  ) then
    _role := 'member';
  end if;

  if _full_name is not null and btrim(_full_name) <> '' then
    if position(' ' in btrim(_full_name)) = 0 then
      _first := btrim(_full_name);
      _last := null;
    else
      _first := btrim(substring(btrim(_full_name) from 1 for (length(btrim(_full_name)) - position(' ' in reverse(btrim(_full_name))))));
      _last := btrim(substring(btrim(_full_name) from (length(btrim(_full_name)) - position(' ' in reverse(btrim(_full_name))) + 2)));
    end if;
  end if;

  insert into public.profiles (id, first_name, last_name, email, role, relationship, org_id)
  values (new.id, _first, _last, new.email, _role, 'primary', _default_org_id);

  insert into public.organization_members (org_id, profile_id)
  values (_default_org_id, new.id)
  on conflict do nothing;

  return new;
end;
$$;

-- Fail-closed verification (run manually after applying, not part of this
-- migration): as the postgres/service-role role (no auth.uid()), attempt
--   insert into public.event_calendars (name, color) values (...);
-- without an explicit org_id. app_current_org_id() resolves to NULL
-- (auth.uid() is NULL, so no profiles row matches), so the NOT NULL
-- constraint on org_id must reject the insert.
