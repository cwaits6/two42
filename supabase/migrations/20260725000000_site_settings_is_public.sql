-- Anon-readable site_settings exposed weekly_zoom_url / weekly_prayer_call_url /
-- call times to unauthenticated REST clients. Add a
-- per-row visibility flag so only rows explicitly marked public are
-- anon-readable; logged-in members keep full read access as before.
-- Future migrations seeding a setting meant to be public-by-design must
-- explicitly set is_public = true; new rows default to private.

alter table public.site_settings
  add column is_public boolean not null default false;

update public.site_settings
  set is_public = true
  where key = 'site_name';

drop policy if exists "Anyone can read settings" on public.site_settings;

create policy "Anon can read public settings"
  on public.site_settings for select
  using (is_public);

create policy "Members can read settings"
  on public.site_settings for select
  using ((select public.is_member()));
