-- Sending new people to the church's records. Off unless a church admin turns
-- it on with a second key of its own; then a person who joins two42 and ticks
-- "Share my details with [church]'s office" is sent once, as their name, email
-- and phone, for the church's staff to review. two42 never changes a record.
--
-- No client role has any privilege on these tables: the service key writes
-- them from server code that has checked a church admin, or from a person's
-- own session for their own row, and filters on that caller's org_id.

-- One row per church while sending is on. Turning it off deletes the row, so
-- no write key is stored while it is off. A new read key for the same records
-- keeps it; disconnecting or moving to other records removes it through the
-- cascade, since a destination id means nothing in other records.
create table public.records_intake_settings (
  org_id uuid primary key default public.app_current_org_id(),
  connection_id uuid not null,
  key_ciphertext text not null,
  key_hint text not null check (char_length(key_hint) between 1 and 4),
  destination_id text not null check (destination_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  destination_name text not null check (char_length(destination_name) between 1 and 200),
  enabled_by uuid,
  enabled_at timestamptz not null default now(),
  constraint records_intake_settings_connection_fkey
    foreign key (org_id, connection_id) references public.records_connections (org_id, connection_id) on delete cascade,
  constraint records_intake_settings_enabled_by_fkey
    foreign key (enabled_by, org_id) references public.profiles (id, org_id) on delete set null (enabled_by)
);

create index records_intake_settings_connection_idx on public.records_intake_settings (org_id, connection_id);
create index records_intake_settings_enabled_by_idx on public.records_intake_settings (enabled_by) where enabled_by is not null;

-- Enums rather than text checks, so the generated types carry these lists to
-- the code that writes them. records_failure is RecordsFailure in
-- supabase/functions/_shared/records-errors.ts.
create type public.records_intake_state as enum ('consented', 'sending', 'sent', 'failed');
create type public.records_failure as enum ('unauthorized', 'not_found', 'unreachable', 'not_provider', 'rejected');

-- Each person's consent and send, at most one row per person, so nobody is sent
-- twice. Kept per church rather than per connection: a person sent once is
-- never sent again after the key or the records change. A failed send is never
-- retried, because a timeout can follow a send the records already took.
create table public.records_intake_requests (
  org_id uuid not null default public.app_current_org_id(),
  profile_id uuid not null,
  state public.records_intake_state not null,
  failure public.records_failure,
  consented_at timestamptz not null default now(),
  finished_at timestamptz,
  primary key (org_id, profile_id),
  constraint records_intake_requests_failed_has_failure check ((state = 'failed') = (failure is not null)),
  constraint records_intake_requests_profile_id_fkey
    foreign key (profile_id, org_id) references public.profiles (id, org_id) on delete cascade
);

create index records_intake_requests_profile_id_idx on public.records_intake_requests (profile_id);
create index records_intake_requests_state_idx on public.records_intake_requests (org_id, state, finished_at);

alter table public.records_intake_settings enable row level security;
alter table public.records_intake_requests enable row level security;

create policy "org isolation" on public.records_intake_settings
  as restrictive for all to anon, authenticated
  using      (org_id = (select public.app_request_org_id()))
  with check (org_id = (select public.app_request_org_id()));

create policy "org isolation" on public.records_intake_requests
  as restrictive for all to anon, authenticated
  using      (org_id = (select public.app_request_org_id()))
  with check (org_id = (select public.app_request_org_id()));

-- Supabase's default privileges grant ALL on a new public table to anon and
-- authenticated; neither gets anything here.
revoke all on public.records_intake_settings from anon, authenticated;
revoke all on public.records_intake_requests from anon, authenticated;

-- Records a person's consent while sending is on and they aren't linked.
-- 'off' and 'linked' store nothing; a consent already recorded, or a send
-- already made, is left as it is.
--
-- SECURITY INVOKER and executable by the service role only: the caller is
-- server code that took the org from the person's setup link or own profile.
create function public.records_intake_consent(_org_id uuid, _profile_id uuid)
  returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  perform 1 from public.records_intake_settings where org_id = _org_id for share;
  if not found then
    return 'off';
  end if;
  if exists (select 1 from public.records_person_links where org_id = _org_id and profile_id = _profile_id) then
    return 'linked';
  end if;
  insert into public.records_intake_requests (org_id, profile_id, state)
  values (_org_id, _profile_id, 'consented')
  on conflict (org_id, profile_id) do nothing;
  return 'saved';
end;
$$;

-- Claims the one send a person gets. Only the move to 'sending' from nothing
-- or from 'consented' is 'claimed'; a second call, or one racing it, gets
-- 'already'. The settings row is held for share, so turning sending off
-- waits for the claim, and a claim after it finds 'off'.
create function public.records_intake_claim(_org_id uuid, _profile_id uuid)
  returns text
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  _claimed integer;
begin
  perform 1 from public.records_intake_settings where org_id = _org_id for share;
  if not found then
    return 'off';
  end if;
  if exists (select 1 from public.records_person_links where org_id = _org_id and profile_id = _profile_id) then
    return 'linked';
  end if;
  insert into public.records_intake_requests (org_id, profile_id, state)
  values (_org_id, _profile_id, 'sending')
  on conflict (org_id, profile_id) do update
    set state = 'sending'
    where public.records_intake_requests.state = 'consented';
  get diagnostics _claimed = row_count;
  return case when _claimed = 1 then 'claimed' else 'already' end;
end;
$$;

revoke execute on function public.records_intake_consent(uuid, uuid) from public, anon, authenticated;
grant execute on function public.records_intake_consent(uuid, uuid) to service_role;
revoke execute on function public.records_intake_claim(uuid, uuid) from public, anon, authenticated;
grant execute on function public.records_intake_claim(uuid, uuid) to service_role;

-- Turning sending off, disconnecting, or moving to other records drops every
-- consent not yet sent, so turning it on again later sends nobody who agreed
-- under the old setting. Rows already sent or failed stay, so they are never
-- sent again.
create function public.records_intake_settings_cleanup()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  delete from public.records_intake_requests where org_id = old.org_id and state = 'consented';
  return old;
end;
$$;

create trigger records_intake_settings_cleanup
  after delete on public.records_intake_settings
  for each row execute function public.records_intake_settings_cleanup();

-- A trigger function is never called directly; EXECUTE is checked only when
-- the trigger is created, so the trigger still fires.
revoke execute on function public.records_intake_settings_cleanup() from public, anon, authenticated;

comment on table public.records_intake_settings is
  'A church''s setting for sending new people to its church records: the write key sealed by the server with RECORDS_KEY_SECRET (separate from the read key), and where in the records new people go. One row per church while it is on; none while it is off. Read and written by the service key only, after a church admin check.';
comment on table public.records_intake_requests is
  'Each person''s consent to be sent to the church''s records, and whether they were sent: at most one row per person, so nobody is sent twice. Holds no details, only the state and its times. Read and written by the service key only.';
