-- A guest reads a host's address only for a supper the guest's own party was
-- seated in time for, the rule supper_party_notes already follows. Without
-- it, a party seated partway through a rotation could read the address of a
-- host whose only supper at that table happened before the party joined.
-- A supper still to come keeps every guest seated at it, so they still read
-- it. The host's party and the group's leaders read it through their own
-- policy arms, which this leaves alone.
--
-- create or replace keeps the function's owner and its grants: execute for
-- authenticated only, revoked from public and anon.
create or replace function public.supper_address_party_ids() returns uuid[]
  language sql stable security definer
  set search_path = ''
as $$
  select coalesce(array_agg(distinct d.host_party_id), '{}')
  from public.suppers d
  join public.supper_seats hs on hs.table_id = d.table_id and hs.party_id = d.host_party_id
   and hs.org_id = d.org_id and hs.left_at is null
  -- The caller's own seat at the supper's table, in place by the time it starts.
  join public.supper_seats s on s.table_id = d.table_id and s.org_id = d.org_id and s.left_at is null
   and s.seated_at <= d.starts_at
   and s.party_id = any (public.supper_my_party_ids())
  where d.org_id = public.app_current_org_id();
$$;

comment on function public.supper_address_party_ids() is
  'The parties hosting a supper at one of the caller''s tables, still seated there, that the caller''s party was seated in time for: the addresses the caller may read. Policy helper.';
