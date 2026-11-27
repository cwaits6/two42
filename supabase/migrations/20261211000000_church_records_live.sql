-- Showing details live from the church's records. A church admin picks Copy
-- (the default) or Live. In live mode two42 keeps only what it needs to run
-- from the records (name, sign-in email, phones, gender and photo); address,
-- birthday, anniversary and a child's grade are read from the records when
-- the directory opens and are never stored. The guards below make the
-- database refuse to store them, so a write path that forgets live mode
-- fails instead of keeping them.
--
-- No new table. The mode lives on records_org_settings, the church's own
-- switches, so it survives reconnecting like the field settings it qualifies.

alter table public.records_org_settings
  add column mode text not null default 'copy' check (mode in ('copy', 'live'));

comment on table public.records_org_settings is
  'A church''s church-records switches: whether its records'' details are copied into two42 or shown live (mode, copy by default), and whether children in a linked household''s family are suggested to its adults (off by default). Members read suggest_children; only the service key writes it, through records_save_children_setting() and records_save_mode().';

-- The fields live mode never stores: the person's birthday, anniversary and
-- grade (records_field_values) and the household's address
-- (records_household_values). Kept beside LIVE_ONLY_FIELDS in
-- supabase/functions/_shared/records-copy.ts.
create function public.records_live_only_field(_field text)
  returns boolean
  language sql immutable set search_path = ''
as $$
  select _field in ('birthday', 'anniversary', 'grade', 'address');
$$;

-- Households whose anniversary is still the church's: some linked person in
-- the household has an anniversary source, and every such source is
-- 'records'. A changed or cleared one makes it the household's own.
create function public.records_live_anniversary_households(_org_id uuid)
  returns table (family_id uuid)
  language sql stable
  security invoker
  set search_path = ''
as $$
  select p.family_id
    from public.records_field_values v
    join public.profiles p on p.id = v.profile_id and p.org_id = v.org_id
   where v.org_id = _org_id and v.field = 'anniversary' and p.family_id is not null
   group by p.family_id
  having bool_and(v.state = 'records');
$$;

-- How many details two42 holds from the records that Copy -> Live removes:
-- each shown value whose source is still the church's, counted once per value
-- (two spouses' sources for one anniversary count once), and each birthday
-- and grade on a child suggestion nobody has decided on.
create function public.records_live_copied_count(_org_id uuid)
  returns integer
  language sql stable
  security invoker
  set search_path = ''
as $$
  select (
    (select count(*) from public.records_field_values v
       join public.profiles p on p.id = v.profile_id and p.org_id = v.org_id
      where v.org_id = _org_id and v.field = 'birthday' and v.state = 'records'
        and (p.birth_month is not null or p.birth_day is not null or p.birth_year is not null))
  + (select count(*) from public.records_field_values v
       join public.family_members m on m.id = (
         select m2.id from public.family_members m2
          where m2.claimed_profile_id = v.profile_id and m2.org_id = v.org_id
          order by m2.id limit 1)
      where v.org_id = _org_id and v.field = 'grade' and v.state = 'records' and m.graduation_year is not null)
  + (select count(*) from public.family_units f
      where f.org_id = _org_id
        and (f.anniversary_month is not null or f.anniversary_day is not null or f.anniversary_year is not null)
        and f.id in (select h.family_id from public.records_live_anniversary_households(_org_id) h))
  + (select count(*) from public.records_household_values v
       join public.family_units f on f.id = v.family_id and f.org_id = v.org_id
      where v.org_id = _org_id and v.field = 'address' and v.state = 'records'
        and (f.address_line1 is not null or f.address_line2 is not null or f.city is not null
             or f.state is not null or f.postal_code is not null))
  + (select count(*) filter (where s.birth_month is not null) + count(*) filter (where s.graduation_year is not null)
       from public.records_child_suggestions s
      where s.org_id = _org_id and s.state = 'open')
  )::integer;
$$;

-- Saves the church's mode. Copy -> Live, in this one transaction: every value
-- whose source is still the church's is cleared from two42, its source row is
-- removed, the church's last value is forgotten on the sources members
-- changed or cleared (they keep their own values and their state), and open
-- child suggestions lose their birthday and grade. Values a member changed
-- stay. Live -> Copy asks the next refresh to copy everyone in full, which
-- fills the values in under the copy rules; the households and children are
-- read in full on every refresh already. A child added while live was added
-- with no birthday or grade and keeps none: an added child's details are the
-- household's, and the refresh never writes them.
--
-- Answers {"outcome":"busy"}, saving nothing, while a refresh holds its claim:
-- that run read the mode when it started. Otherwise {"outcome":"saved",
-- "removed": <the details removed>}. The 15 minutes match the claim's lease, as
-- in records_save_field_settings().
--
-- SECURITY INVOKER and executable by the service role only: the caller is
-- server code that has checked the church admin and passes that admin's org.
-- Running as the service role keeps the member-edit triggers from counting
-- these writes as a member's edit.
create function public.records_save_mode(_org_id uuid, _mode text, _updated_by uuid)
  returns jsonb
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  _running timestamptz;
  _before text;
  _removed integer := 0;
begin
  if _mode not in ('copy', 'live') then
    raise exception 'records_save_mode: unknown mode' using errcode = '22023';
  end if;
  insert into public.records_refresh_state (org_id, connection_id)
  select org_id, connection_id from public.records_connections where org_id = _org_id
  on conflict (org_id) do nothing;
  select running_since into _running from public.records_refresh_state
   where org_id = _org_id
     for update;
  if _running is not null and _running > now() - interval '15 minutes' then
    return jsonb_build_object('outcome', 'busy');
  end if;

  select mode into _before from public.records_org_settings where org_id = _org_id for update;
  _before := coalesce(_before, 'copy');
  if _before = _mode then
    return jsonb_build_object('outcome', 'saved', 'removed', 0);
  end if;

  if _mode = 'live' then
    -- Locks the rows to clear before any statement below reads their sources.
    -- An UPDATE that waits on a member's edit rechecks the row it updates but
    -- not the source it joined, so it would clear the member's new value;
    -- once locked, the next statements see the source that edit wrote.
    perform 1 from public.profiles p
      join public.records_field_values v on v.profile_id = p.id and v.org_id = p.org_id
     where p.org_id = _org_id and v.field = 'birthday' and v.state = 'records'
       for update of p;
    perform 1 from public.family_members m
      join public.records_field_values v on v.profile_id = m.claimed_profile_id and v.org_id = m.org_id
     where m.org_id = _org_id and v.field = 'grade' and v.state = 'records'
       for update of m;
    perform 1 from public.family_units f
     where f.org_id = _org_id
       and (f.id in (select h.family_id from public.records_live_anniversary_households(_org_id) h)
            or f.id in (select hv.family_id from public.records_household_values hv
                         where hv.org_id = _org_id and hv.field = 'address' and hv.state = 'records'))
       for update of f;

    _removed := public.records_live_copied_count(_org_id);

    update public.profiles p set birth_month = null, birth_day = null, birth_year = null
      from public.records_field_values v
     where v.org_id = _org_id and v.field = 'birthday' and v.state = 'records'
       and p.id = v.profile_id and p.org_id = _org_id;

    -- The copy owns only the person's lowest-id claimed row, as records_apply_copy() picks it.
    update public.family_members m set graduation_year = null
      from public.records_field_values v
     where v.org_id = _org_id and v.field = 'grade' and v.state = 'records'
       and m.org_id = _org_id
       and m.id = (
         select m2.id from public.family_members m2
          where m2.claimed_profile_id = v.profile_id and m2.org_id = _org_id
          order by m2.id limit 1);

    update public.family_units f set anniversary_month = null, anniversary_day = null, anniversary_year = null
     where f.org_id = _org_id
       and f.id in (select h.family_id from public.records_live_anniversary_households(_org_id) h);

    update public.family_units f
       set address_line1 = null, address_line2 = null, city = null, state = null, postal_code = null
      from public.records_household_values v
     where v.org_id = _org_id and v.field = 'address' and v.state = 'records'
       and f.id = v.family_id and f.org_id = _org_id;

    delete from public.records_field_values
     where org_id = _org_id and public.records_live_only_field(field) and state = 'records';
    update public.records_field_values set church_value = '{}'::jsonb, updated_at = now()
     where org_id = _org_id and public.records_live_only_field(field) and church_value <> '{}'::jsonb;
    delete from public.records_household_values
     where org_id = _org_id and public.records_live_only_field(field) and state = 'records';
    update public.records_household_values set church_value = '{}'::jsonb, updated_at = now()
     where org_id = _org_id and public.records_live_only_field(field) and church_value <> '{}'::jsonb;

    update public.records_child_suggestions
       set birth_month = null, birth_day = null, graduation_year = null, updated_at = now()
     where org_id = _org_id and state = 'open'
       and (birth_month is not null or birth_day is not null or graduation_year is not null);
  else
    update public.records_person_state set copied_at = null
     where org_id = _org_id and copied_at is not null;
  end if;

  -- Last, so the guards below still see copy mode while the sources are rewritten.
  insert into public.records_org_settings (org_id, mode, updated_by, updated_at)
  values (_org_id, _mode, _updated_by, now())
  on conflict (org_id) do update
    set mode = excluded.mode, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  return jsonb_build_object('outcome', 'saved', 'removed', _removed);
end;
$$;

-- In live mode a source for a live-only field may record only a member's own
-- change or clear: never the church's value, and never 'records'. Every copy
-- of one of these fields writes its source in the same call
-- (records_apply_copy(), records_apply_household_copy()), so refusing the
-- source refuses the whole copy.
create function public.records_live_value_guard()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  if public.records_live_only_field(new.field)
     and (new.state = 'records' or new.church_value <> '{}'::jsonb)
     and exists (select 1 from public.records_org_settings s where s.org_id = new.org_id and s.mode = 'live') then
    raise exception 'live mode stores no % from the church''s records', new.field using errcode = 'RC002';
  end if;
  return new;
end;
$$;

create trigger records_live_value_guard
  before insert or update on public.records_field_values
  for each row execute function public.records_live_value_guard();

create trigger records_live_value_guard
  before insert or update on public.records_household_values
  for each row execute function public.records_live_value_guard();

-- In live mode a suggested child carries only names and the photo's token.
create function public.records_live_child_guard()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  if (new.birth_month is not null or new.birth_day is not null or new.graduation_year is not null)
     and exists (select 1 from public.records_org_settings s where s.org_id = new.org_id and s.mode = 'live') then
    raise exception 'live mode stores no child''s birthday or grade from the church''s records' using errcode = 'RC002';
  end if;
  return new;
end;
$$;

create trigger records_live_child_guard
  before insert or update on public.records_child_suggestions
  for each row execute function public.records_live_child_guard();

-- A member hides, or shows again, a detail the directory shows live from the
-- church's records. In two42 a person hides a detail by leaving it out, but a
-- live value is never in two42 to leave out, so hiding records a 'cleared'
-- source, which the directory honours and the copy rules keep if the church
-- switches back to copy. Showing again removes that source. The birthday is
-- the caller's own; the anniversary and address are the caller's household's,
-- for its primary or spouse.
--
-- SECURITY DEFINER because members have no write grant on the sources. The
-- org, person and household come from auth.uid()'s own profile, never a
-- parameter; anything not allowed raises RC001.
create function public.records_live_hide(_field text, _hidden boolean)
  returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  _me public.profiles%rowtype;
  _count integer;
begin
  select * into _me from public.profiles
   where id = auth.uid() and org_id = public.app_current_org_id();
  if not found or _me.role not in ('member', 'admin')
     or not exists (select 1 from public.records_org_settings where org_id = _me.org_id and mode = 'live') then
    raise exception 'records_live_hide: not allowed' using errcode = 'RC001';
  end if;

  if _field = 'birthday' then
    if not exists (select 1 from public.records_person_links where org_id = _me.org_id and profile_id = _me.id) then
      raise exception 'records_live_hide: not allowed' using errcode = 'RC001';
    end if;
    if _hidden then
      insert into public.records_field_values (org_id, profile_id, field, state)
      values (_me.org_id, _me.id, 'birthday', 'cleared')
      on conflict (org_id, profile_id, field) do nothing;
    else
      delete from public.records_field_values
       where org_id = _me.org_id and profile_id = _me.id and field = 'birthday' and state = 'cleared';
    end if;
    return;
  end if;

  if _field not in ('anniversary', 'address') or _me.family_id is null
     or _me.relationship not in ('primary', 'spouse') then
    raise exception 'records_live_hide: not allowed' using errcode = 'RC001';
  end if;

  if _field = 'address' then
    if not exists (
      select 1 from public.records_household_links where org_id = _me.org_id and family_id = _me.family_id
    ) then
      raise exception 'records_live_hide: not allowed' using errcode = 'RC001';
    end if;
    if _hidden then
      insert into public.records_household_values (org_id, family_id, field, state)
      values (_me.org_id, _me.family_id, 'address', 'cleared')
      on conflict (org_id, family_id, field) do nothing;
    else
      delete from public.records_household_values
       where org_id = _me.org_id and family_id = _me.family_id and field = 'address' and state = 'cleared';
    end if;
    return;
  end if;

  -- The anniversary's source is per linked person, so every linked person in
  -- the household carries the hide, as records_household_member_edit() marks them together.
  if _hidden then
    insert into public.records_field_values (org_id, profile_id, field, state)
    select l.org_id, l.profile_id, 'anniversary', 'cleared'
      from public.records_person_links l
      join public.profiles p on p.id = l.profile_id and p.org_id = l.org_id
     where l.org_id = _me.org_id and p.family_id = _me.family_id
    on conflict (org_id, profile_id, field) do nothing;
    get diagnostics _count = row_count;
    if _count = 0 and not exists (
      select 1 from public.records_field_values v
        join public.profiles p on p.id = v.profile_id and p.org_id = v.org_id
       where v.org_id = _me.org_id and v.field = 'anniversary' and p.family_id = _me.family_id
    ) then
      raise exception 'records_live_hide: not allowed' using errcode = 'RC001';
    end if;
  else
    delete from public.records_field_values v
     using public.profiles p
     where v.org_id = _me.org_id and v.field = 'anniversary' and v.state = 'cleared'
       and p.id = v.profile_id and p.org_id = v.org_id and p.family_id = _me.family_id;
  end if;
end;
$$;

revoke execute on function public.records_live_only_field(text) from public, anon, authenticated;
revoke execute on function public.records_live_anniversary_households(uuid) from public, anon, authenticated;
revoke execute on function public.records_live_copied_count(uuid) from public, anon, authenticated;
revoke execute on function public.records_save_mode(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.records_live_anniversary_households(uuid) to service_role;
grant execute on function public.records_live_copied_count(uuid) to service_role;
grant execute on function public.records_save_mode(uuid, text, uuid) to service_role;
-- A trigger function is never called directly; EXECUTE is checked only when
-- the trigger is created, so the triggers still fire for every role.
revoke execute on function public.records_live_value_guard() from public, anon, authenticated;
revoke execute on function public.records_live_child_guard() from public, anon, authenticated;
revoke execute on function public.records_live_hide(text, boolean) from public, anon;
grant execute on function public.records_live_hide(text, boolean) to authenticated;

comment on function public.records_save_mode(uuid, text, uuid) is
  'A church admin''s choice of copy or live mode; Copy -> Live removes every value still the church''s in one transaction. Service key only.';
comment on function public.records_live_copied_count(uuid) is
  'How many details from the church''s records Copy -> Live would remove. Service key only.';
comment on function public.records_live_hide(text, boolean) is
  'A member hides, or shows again, their own birthday or, as the household''s primary or spouse, its anniversary or address shown live from the church''s records. Org and person from auth.uid()''s profile.';
