-- Storage tenancy (CWA-57 / #328): every storage.objects policy predated the
-- org spine and none mentioned org_id — "Editors can update event images" let
-- any org's content editor overwrite every event image on the platform, and
-- "Admins can delete family photos" let any org's admin destroy any other
-- org's family portraits. Object keys become org-partitioned
-- (`<org_id>/<kind>/<entity_id>/<file>`, so (storage.foldername(name))[1] is
-- the org, [2] the kind, [3] the entity), a restrictive "org isolation" floor
-- mirrors the table-level pattern of 20260731000003, and all 17 permissive
-- policies are rewritten as ORG AND (arms). Both buckets deliberately remain
-- `public => true` (ADR-3, docs/security/tenancy-model.md): the live
-- vulnerability is write/delete, not read — read secrecy rests on
-- unguessable UUID paths exactly as before, and private buckets + signed
-- URLs are a tracked follow-up. Physical re-key of existing objects is an
-- operator script (scripts/rekey-storage-objects.mjs), NOT a SQL UPDATE —
-- Supabase Storage keys the blob by bucket/name, so renaming the DB row
-- would orphan the file.

-- ── Drop all 17 legacy (org-blind) policies ─────────────────────────────────

drop policy if exists "Public can view avatars" on storage.objects;
drop policy if exists "Public can view event images" on storage.objects;
drop policy if exists "Members can upload own avatar" on storage.objects;
drop policy if exists "Members can update own avatar" on storage.objects;
drop policy if exists "Members can delete own avatar" on storage.objects;
drop policy if exists "Editors can upload event images" on storage.objects;
drop policy if exists "Editors can update event images" on storage.objects;
drop policy if exists "Editors can delete event images" on storage.objects;
drop policy if exists "Admins can upload family photos" on storage.objects;
drop policy if exists "Admins can update family photos" on storage.objects;
drop policy if exists "Admins can delete family photos" on storage.objects;
drop policy if exists "Members can upload household family member avatars" on storage.objects;
drop policy if exists "Members can update household family member avatars" on storage.objects;
drop policy if exists "Members can delete household family member avatars" on storage.objects;
drop policy if exists "Household leaders can upload household member avatars" on storage.objects;
drop policy if exists "Household leaders can update household member avatars" on storage.objects;
drop policy if exists "Household leaders can delete household member avatars" on storage.objects;

-- ── The restrictive org floor ───────────────────────────────────────────────
-- storage.objects has no org_id column; the first path segment is its
-- analogue. Restrictive policies AND with the OR-combined permissive set, so
-- a future permissive policy that forgets its org predicate is still
-- contained. `to anon, authenticated` only: service_role and postgres carry
-- BYPASSRLS (the re-key script and the storage service itself), and public
-- buckets serve reads via /object/public/* without consulting RLS at all —
-- this floor governs the PostgREST read path and every write path.
--
-- app_request_org_id() resolves NULL for a principal-less request with no
-- x-two42-org header; `[1] = NULL::text` is not TRUE, so the floor fails
-- closed. A legacy un-prefixed key ('<uid>/avatar.jpg') has a non-UUID [1]
-- and is likewise invisible to writes/deletes until the re-key script moves
-- it.

drop policy if exists "org isolation" on storage.objects;
create policy "org isolation" on storage.objects
  as restrictive for all to anon, authenticated
  using      ((storage.foldername(name))[1] = (select public.app_request_org_id())::text)
  with check ((storage.foldername(name))[1] = (select public.app_request_org_id())::text);

-- ── Permissive replacements, each factored ORG AND (arms) ───────────────────
-- Every helper call is wrapped as (select …) — the InitPlan rule
-- (docs/security/tenancy-model.md; this repo has regressed on it twice) —
-- and every entity comparison is `entity.id::text = segment`, never
-- `segment::uuid`: a non-UUID path segment must be denied, not raise 22P02.

-- Public (org-resolved) reads. Anonymous PostgREST readers resolve their org
-- from the x-two42-org header; the actual public serving path
-- (/object/public/*) bypasses RLS entirely, so these matter for listing and
-- for authenticated API reads.
create policy "Public can view avatars"
  on storage.objects for select to anon, authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select public.app_request_org_id())::text
  );

create policy "Public can view event images"
  on storage.objects for select to anon, authenticated
  using (
    bucket_id = 'event-images'
    and (storage.foldername(name))[1] = (select public.app_request_org_id())::text
  );

-- Own profile avatar: <org>/profiles/<auth.uid()>/…
-- (is_member() on update/delete is a deliberate tightening — the legacy
-- update/delete policies omitted the role check the insert policy had.)
create policy "Members can upload own avatar"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select public.app_request_org_id())::text
    and (select public.is_member())
    and (storage.foldername(name))[2] = 'profiles'
    and (storage.foldername(name))[3] = (select auth.uid())::text
  );

create policy "Members can update own avatar"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select public.app_request_org_id())::text
    and (select public.is_member())
    and (storage.foldername(name))[2] = 'profiles'
    and (storage.foldername(name))[3] = (select auth.uid())::text
  );

create policy "Members can delete own avatar"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select public.app_request_org_id())::text
    and (select public.is_member())
    and (storage.foldername(name))[2] = 'profiles'
    and (storage.foldername(name))[3] = (select auth.uid())::text
  );

-- Household leaders (primary/spouse) manage other enrolled household
-- members' profile avatars: <org>/profiles/<other household profile>/…
create policy "Household leaders can upload household member avatars"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select public.app_request_org_id())::text
    and (select public.is_member())
    and (storage.foldername(name))[2] = 'profiles'
    and (storage.foldername(name))[3] in (
      select p.id::text
      from public.profiles p
      where p.family_id = (select public.current_family_id())
        and p.family_id is not null
        and p.id <> (select auth.uid())
    )
    and exists (
      select 1 from public.profiles self
      where self.id = (select auth.uid())
        and self.relationship in ('primary', 'spouse')
    )
  );

create policy "Household leaders can update household member avatars"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select public.app_request_org_id())::text
    and (select public.is_member())
    and (storage.foldername(name))[2] = 'profiles'
    and (storage.foldername(name))[3] in (
      select p.id::text
      from public.profiles p
      where p.family_id = (select public.current_family_id())
        and p.family_id is not null
        and p.id <> (select auth.uid())
    )
    and exists (
      select 1 from public.profiles self
      where self.id = (select auth.uid())
        and self.relationship in ('primary', 'spouse')
    )
  );

create policy "Household leaders can delete household member avatars"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select public.app_request_org_id())::text
    and (select public.is_member())
    and (storage.foldername(name))[2] = 'profiles'
    and (storage.foldername(name))[3] in (
      select p.id::text
      from public.profiles p
      where p.family_id = (select public.current_family_id())
        and p.family_id is not null
        and p.id <> (select auth.uid())
    )
    and exists (
      select 1 from public.profiles self
      where self.id = (select auth.uid())
        and self.relationship in ('primary', 'spouse')
    )
  );

-- Non-auth family-member avatars: <org>/family-members/<family_member_id>/…,
-- scoped to the caller's own household. RLS applies inside the IN subquery
-- (read as the caller), so the org floor on family_members already filters
-- it — defence in depth, not the primary boundary.
create policy "Members can upload household family member avatars"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select public.app_request_org_id())::text
    and (select public.is_member())
    and (storage.foldername(name))[2] = 'family-members'
    and (storage.foldername(name))[3] in (
      select fm.id::text
      from public.family_members fm
      where fm.family_id = (select public.current_family_id())
    )
  );

create policy "Members can update household family member avatars"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select public.app_request_org_id())::text
    and (select public.is_member())
    and (storage.foldername(name))[2] = 'family-members'
    and (storage.foldername(name))[3] in (
      select fm.id::text
      from public.family_members fm
      where fm.family_id = (select public.current_family_id())
    )
  );

create policy "Members can delete household family member avatars"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select public.app_request_org_id())::text
    and (select public.is_member())
    and (storage.foldername(name))[2] = 'family-members'
    and (storage.foldername(name))[3] in (
      select fm.id::text
      from public.family_members fm
      where fm.family_id = (select public.current_family_id())
    )
  );

-- Family portraits: <org>/families/<family_id>/…. The per-family EXISTS is
-- new — the legacy policy was prefix-scoped to 'families/' but not to a
-- family, which combined with the missing org predicate was the headline
-- cross-tenant delete. is_admin() is org-scoped; family_units is read as the
-- caller, so its own org floor filters it to the caller's org.
create policy "Admins can upload family photos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select public.app_request_org_id())::text
    and (select public.is_admin())
    and (storage.foldername(name))[2] = 'families'
    and exists (
      select 1 from public.family_units f
      where f.id::text = (storage.foldername(name))[3]
    )
  );

create policy "Admins can update family photos"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select public.app_request_org_id())::text
    and (select public.is_admin())
    and (storage.foldername(name))[2] = 'families'
    and exists (
      select 1 from public.family_units f
      where f.id::text = (storage.foldername(name))[3]
    )
  );

create policy "Admins can delete family photos"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select public.app_request_org_id())::text
    and (select public.is_admin())
    and (storage.foldername(name))[2] = 'families'
    and exists (
      select 1 from public.family_units f
      where f.id::text = (storage.foldername(name))[3]
    )
  );

-- Event images: <org>/events/<event_id>/…. The per-event EXISTS is new — the
-- legacy policies were platform-wide for any content editor (the exact CVE
-- in CWA-57). The app currently has no event-image writer (harden, don't
-- drop — the bucket and the uploadImage "event" config exist for a planned
-- feature).
create policy "Editors can upload event images"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'event-images'
    and (storage.foldername(name))[1] = (select public.app_request_org_id())::text
    and (select public.is_content_editor())
    and (storage.foldername(name))[2] = 'events'
    and exists (
      select 1 from public.events e
      where e.id::text = (storage.foldername(name))[3]
    )
  );

create policy "Editors can update event images"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'event-images'
    and (storage.foldername(name))[1] = (select public.app_request_org_id())::text
    and (select public.is_content_editor())
    and (storage.foldername(name))[2] = 'events'
    and exists (
      select 1 from public.events e
      where e.id::text = (storage.foldername(name))[3]
    )
  );

create policy "Editors can delete event images"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'event-images'
    and (storage.foldername(name))[1] = (select public.app_request_org_id())::text
    and (select public.is_content_editor())
    and (storage.foldername(name))[2] = 'events'
    and exists (
      select 1 from public.events e
      where e.id::text = (storage.foldername(name))[3]
    )
  );
