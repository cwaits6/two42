-- Drop the legacy global uniques. The org spine migration kept
-- single-column uniques on the four re-scoped
-- tables so existing app onConflict targets kept working while only one org
-- existed. The RLS rewrite's own gate makes deferring this impossible:
-- provision_organization() seeds settings and an about page for a second
-- org, and a global unique on site_settings.key means that seed fails.
--
-- App-side audit (same PR): the only PostgREST upsert against any of these
-- four tables is the about_page editor (app/admin/about/AboutEditor.tsx),
-- which sends no on_conflict param — PostgREST infers the primary key
-- (org_id, id) as the arbiter, and org_id fills from its fail-closed
-- DEFAULT, so the upsert stays a per-org singleton write. The pgTAP suite
-- asserts that exact statement shape. site_settings and page_content are
-- written via UPDATE (org-scoped by RLS) and plain INSERT respectively;
-- class_teachers has no upsert. No app onConflict target references any of
-- the dropped uniques.

alter table public.site_settings  drop constraint site_settings_key_legacy_key;
alter table public.page_content   drop constraint page_content_slug_legacy_key;
alter table public.about_page     drop constraint about_page_id_legacy_key;
alter table public.class_teachers drop constraint class_teachers_profile_id_legacy_key;
