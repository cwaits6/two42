-- Fund recipients suite: a fund's people stay in its group, a fund that loses its
-- recipient stops taking gifts and is never deleted, and only a leader of the
-- group puts it back.
--
-- Run locally (rollback-safe, never mutates the shared local stack):
--
--   docker exec -i supabase_db_small-group-hub \
--     psql -U postgres -d postgres -f - < supabase/tests/giving_recipients_suite.sql
--
-- Runs in CI via `supabase test db` against an ephemeral, isolated Postgres.

begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ── Helpers ─────────────────────────────────────────────────────────────────
create temp table fx (key text primary key, id uuid) on commit drop;
grant select on fx to authenticated;

create function pg_temp.fx(_key text) returns uuid language sql stable as $$
  select id from fx where key = _key;
$$;

create function pg_temp.new_person(_org uuid, _email text, _role text default 'member') returns uuid
language plpgsql as $$
declare _id uuid := gen_random_uuid();
begin
  insert into public.access_requests (org_id, name, email, status, approved_role, reviewed_at)
    values (_org, _email, _email, 'approved', 'member', now());
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values (_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', _email,
            'x', jsonb_build_object('org_id', _org), '{}', now(), now());
  update public.profiles set role = _role where id = _id;
  return _id;
end $$;

-- rows:<n> on success, the SQLSTATE on failure.
create function pg_temp.attempt(_who text, _sql text) returns text language plpgsql as $$
declare n bigint; r text;
begin
  perform set_config('request.headers', '{}', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.fx(_who), 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    execute _sql;
    get diagnostics n = row_count;
    r := 'rows:' || n;
  exception when others then
    r := sqlstate;
  end;
  set local role none;
  perform set_config('request.jwt.claims', '', true);
  return r;
end $$;

-- How many rows the person can read.
create function pg_temp.visible(_who text, _sql text) returns bigint language plpgsql as $$
declare n bigint;
begin
  perform set_config('request.headers', '{}', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.fx(_who), 'role', 'authenticated')::text, true);
  set local role authenticated;
  execute 'select count(*) from (' || _sql || ') q' into n;
  set local role none;
  perform set_config('request.jwt.claims', '', true);
  return n;
end $$;

create function pg_temp.new_fund(_name text, _steward text, _second text default null,
                                 _active boolean default true) returns uuid language plpgsql as $$
declare _id uuid;
begin
  insert into public.giving_funds (org_id, group_id, name, steward_id, co_steward_id, steward_role, is_active)
    values (pg_temp.fx('org'), pg_temp.fx('group'), _name, pg_temp.fx(_steward), pg_temp.fx(_second), 'Treasurer', _active)
    returning id into _id;
  insert into public.giving_fund_methods (fund_id, org_id, group_id, method, custom_handle)
    values (_id, pg_temp.fx('org'), pg_temp.fx('group'), 'venmo', '@' || _name);
  return _id;
end $$;

-- steward|second|role|flag|active, each person by fixture key.
create function pg_temp.state(_fund uuid) returns text language sql stable as $$
  select concat_ws('|',
    coalesce((select key from fx where id = f.steward_id), 'none'),
    coalesce((select key from fx where id = f.co_steward_id), 'none'),
    coalesce(f.steward_role, 'no role'),
    case when f.needs_review then 'review' else 'clear' end,
    case when f.is_active then 'active' else 'retired' end)
  from public.giving_funds f where f.id = _fund;
$$;

create function pg_temp.methods(_fund uuid) returns bigint language sql stable as $$
  select count(*) from public.giving_fund_methods where fund_id = _fund;
$$;

create function pg_temp.set_mode(_mode text) returns void language sql as $$
  update public.site_settings set value = _mode
  where org_id = pg_temp.fx('org') and key = 'giving_manage_mode';
$$;

create function pg_temp.leave(_who text) returns void language sql as $$
  delete from public.group_members
  where group_id = pg_temp.fx('group') and profile_id = pg_temp.fx(_who);
$$;

-- ── Fixture ─────────────────────────────────────────────────────────────────
do $$
declare
  _org uuid := gen_random_uuid();
  _other uuid := gen_random_uuid();
  _group uuid := gen_random_uuid();
  _group2 uuid := gen_random_uuid();
  _other_group uuid := gen_random_uuid();
begin
  insert into public.organizations (id, name) values (_org, 'Fund Church'), (_other, 'Other Church');
  insert into public.groups (id, org_id, name) values
    (_group, _org, 'Fund Group'), (_group2, _org, 'Second Group'), (_other_group, _other, 'Other Group');
  insert into public.site_settings (org_id, key, value) values (_org, 'giving_manage_mode', 'stewards')
    on conflict do nothing;
  insert into fx values ('org', _org), ('other_org', _other), ('group', _group), ('group2', _group2),
    ('other_group', _other_group);
end $$;

insert into fx values
  ('leader', pg_temp.new_person(pg_temp.fx('org'), 'leader@funds.test')),
  ('recipient', pg_temp.new_person(pg_temp.fx('org'), 'recipient@funds.test')),
  ('second', pg_temp.new_person(pg_temp.fx('org'), 'second@funds.test')),
  ('member', pg_temp.new_person(pg_temp.fx('org'), 'member@funds.test')),
  ('leader2', pg_temp.new_person(pg_temp.fx('org'), 'leader2@funds.test')),
  ('church_admin', pg_temp.new_person(pg_temp.fx('org'), 'admin@funds.test', 'admin')),
  ('outside', pg_temp.new_person(pg_temp.fx('org'), 'outside@funds.test')),
  ('foreign', pg_temp.new_person(pg_temp.fx('other_org'), 'foreign@funds.test', 'admin'));

insert into public.group_members (org_id, group_id, profile_id, role)
select pg_temp.fx('org'), pg_temp.fx(g), pg_temp.fx(k), r
from (values ('group', 'leader', 'leader'), ('group', 'recipient', 'member'), ('group', 'second', 'member'),
             ('group', 'member', 'member'), ('group2', 'leader2', 'leader'), ('group2', 'second', 'leader')) v(g, k, r)
on conflict (group_id, profile_id) do update set role = excluded.role;
insert into public.group_members (org_id, group_id, profile_id, role)
values (pg_temp.fx('other_org'), pg_temp.fx('other_group'), pg_temp.fx('foreign'), 'leader')
on conflict (group_id, profile_id) do update set role = excluded.role;

-- ── The functions are tenant boundaries ─────────────────────────────────────
select ok((select bool_and(p.prosecdef) from pg_proc p
           where p.oid in ('public.giving_fund_recipients_guard()'::regprocedure,
                           'public.group_member_removed_leaves_funds()'::regprocedure)),
  'both trigger functions are SECURITY DEFINER');
select is((select count(*) from pg_proc p
           where p.oid in ('public.giving_fund_recipients_guard()'::regprocedure,
                           'public.group_member_removed_leaves_funds()'::regprocedure,
                           'public.giving_funds_apply_recipient_rules()'::regprocedure)
             and p.proconfig = array['search_path=""']), 3::bigint, 'all three pin an empty search_path');
select ok(not has_function_privilege(r, f, 'execute'), format('%s can''t run %s', r, f))
from unnest(array['anon', 'authenticated']) r,
     unnest(array['public.giving_fund_recipients_guard()', 'public.group_member_removed_leaves_funds()',
                  'public.giving_funds_apply_recipient_rules()']) f;
select ok(not has_function_privilege('service_role', 'public.giving_funds_apply_recipient_rules()', 'execute'),
  'nor can the service role run the backfill');

-- ── Writes name only the group's members ────────────────────────────────────
create function pg_temp.insert_sql(_steward text, _second text) returns text language sql stable as $$
  select format(
    'insert into public.giving_funds (org_id, group_id, name, steward_id, co_steward_id, created_by) values (%L, %L, ''x'', %L, %L, %L)',
    pg_temp.fx('org'), pg_temp.fx('group'), pg_temp.fx(_steward), pg_temp.fx(_second), pg_temp.fx('leader'));
$$;
select is(pg_temp.attempt('leader', pg_temp.insert_sql('member', 'second')), 'rows:1',
  'non-vacuity: a leader adds a fund naming two members of the group');
select is(pg_temp.attempt('leader', pg_temp.insert_sql('outside', null)), '23514',
  'an insert naming a recipient outside the group is refused');
select is(pg_temp.attempt('leader', pg_temp.insert_sql('member', 'outside')), '23514',
  'an insert naming a second person outside the group is refused');
select is(pg_temp.attempt('leader', pg_temp.insert_sql('foreign', null)), '23514',
  'an insert naming a recipient from another church is refused');
select is(pg_temp.attempt('leader', pg_temp.insert_sql('member', 'foreign')), '23514',
  'an insert naming a second person from another church is refused');
select is(pg_temp.attempt('leader', pg_temp.insert_sql(null, null)), '23514',
  'a fund can''t be added with no recipient and no review flag');

insert into fx values ('write', pg_temp.new_fund('Write', 'recipient'));
create function pg_temp.update_sql(_column text, _who text) returns text language sql stable as $$
  select format('update public.giving_funds set %I = %L where id = %L', _column, pg_temp.fx(_who), pg_temp.fx('write'));
$$;
select is(pg_temp.attempt('leader', pg_temp.update_sql('steward_id', 'outside')), '23514',
  'changing the recipient to someone outside the group is refused');
select is(pg_temp.attempt('leader', pg_temp.update_sql('co_steward_id', 'outside')), '23514',
  'changing the second person to someone outside the group is refused');
select is(pg_temp.attempt('leader', pg_temp.update_sql('steward_id', 'foreign')), '23514',
  'changing the recipient to someone from another church is refused');
select is(pg_temp.attempt('leader', pg_temp.update_sql('co_steward_id', 'foreign')), '23514',
  'changing the second person to someone from another church is refused');
select is(pg_temp.state(pg_temp.fx('write')), 'recipient|none|Treasurer|clear|active', 'and the fund is unchanged');
select is(pg_temp.attempt('leader', pg_temp.update_sql('steward_id', 'second')), 'rows:1',
  'a leader changes the recipient on a live fund');
select is(pg_temp.state(pg_temp.fx('write')), 'second|none|Treasurer|clear|active',
  'with no review: the leader made the change themself');
select is(
  pg_temp.attempt('leader', format('update public.giving_funds set group_id = %L where id = %L', pg_temp.fx('group2'), pg_temp.fx('write'))),
  '42501', 'a fund can''t move to a group its leader doesn''t lead');
select is(
  pg_temp.attempt('church_admin', format('update public.giving_funds set name = ''y'' where id = %L', pg_temp.fx('write'))),
  'rows:0', 'a church admin outside the group has no write on the fund');
delete from public.giving_funds where id = pg_temp.fx('write');

-- ── Someone leaving ─────────────────────────────────────────────────────────
insert into fx values
  ('promote', pg_temp.new_fund('Promote', 'recipient', 'second')),
  ('alone', pg_temp.new_fund('Alone', 'recipient')),
  ('retired', pg_temp.new_fund('Retired', 'recipient', 'second', false)),
  ('second_only', pg_temp.new_fund('SecondOnly', 'member', 'recipient')),
  ('untouched', pg_temp.new_fund('Untouched', 'member', 'second'));

select pg_temp.leave('recipient');
select is(pg_temp.state(pg_temp.fx('promote')), 'second|none|no role|review|active',
  'recipient leaves: the second person takes over, with no role, and the fund needs review');
select is(pg_temp.methods(pg_temp.fx('promote')), 1::bigint, 'and keeps its payment methods');
select is(pg_temp.state(pg_temp.fx('alone')), 'none|none|no role|review|active',
  'recipient leaves with no second person: the fund has no recipient');
select is(pg_temp.methods(pg_temp.fx('alone')), 1::bigint, 'and keeps its payment methods');
select is(pg_temp.state(pg_temp.fx('retired')), 'second|none|no role|review|retired',
  'a retired fund stays retired through it');
select is(pg_temp.state(pg_temp.fx('second_only')), 'member|none|Treasurer|clear|active',
  'second person leaves: the slot empties and the fund is otherwise unchanged');
select is(pg_temp.state(pg_temp.fx('untouched')), 'member|second|Treasurer|clear|active',
  'a fund they aren''t on doesn''t change');

insert into public.group_members (org_id, group_id, profile_id) values (pg_temp.fx('org'), pg_temp.fx('group'), pg_temp.fx('recipient'));
select is(pg_temp.state(pg_temp.fx('alone')), 'none|none|no role|review|active', 'rejoining doesn''t restore them');

-- Leaving another group changes nothing here.
insert into fx values ('elsewhere', pg_temp.new_fund('Elsewhere', 'recipient', 'second'));
delete from public.group_members where group_id = pg_temp.fx('group2') and profile_id = pg_temp.fx('second');
select is(pg_temp.state(pg_temp.fx('elsewhere')), 'recipient|second|Treasurer|clear|active',
  'leaving a different group doesn''t touch this group''s funds');
insert into public.group_members (org_id, group_id, profile_id, role) values (pg_temp.fx('org'), pg_temp.fx('group2'), pg_temp.fx('second'), 'leader');

-- A write that keeps the membership isn't leaving; one that moves it is.
update public.group_members set profile_id = profile_id where group_id = pg_temp.fx('group') and profile_id = pg_temp.fx('recipient');
select is(pg_temp.state(pg_temp.fx('elsewhere')), 'recipient|second|Treasurer|clear|active',
  'rewriting a membership in place leaves the fund alone');

-- Both people, in one statement and then one after the other, in each order.
delete from public.group_members where group_id = pg_temp.fx('group') and profile_id in (pg_temp.fx('recipient'), pg_temp.fx('second'));
select is(pg_temp.state(pg_temp.fx('elsewhere')), 'none|none|no role|review|active',
  'both leave in one statement: nobody to promote');
select is(pg_temp.methods(pg_temp.fx('elsewhere')), 1::bigint, 'and the payment methods stay');
insert into public.group_members (org_id, group_id, profile_id)
  select pg_temp.fx('org'), pg_temp.fx('group'), pg_temp.fx(k) from unnest(array['recipient', 'second']) k;

insert into fx values ('r_first', pg_temp.new_fund('RFirst', 'recipient', 'second')),
                      ('s_first', pg_temp.new_fund('SFirst', 'recipient', 'second'));
select pg_temp.leave('recipient');
select is(pg_temp.state(pg_temp.fx('r_first')), 'second|none|no role|review|active', 'recipient first: the second person is promoted');
select pg_temp.leave('second');
select is(pg_temp.state(pg_temp.fx('r_first')), 'none|none|no role|review|active', 'then they leave too: no recipient');
select is(pg_temp.state(pg_temp.fx('s_first')), 'none|none|no role|review|active', 'the same transaction ends the same way');
insert into public.group_members (org_id, group_id, profile_id)
  select pg_temp.fx('org'), pg_temp.fx('group'), pg_temp.fx(k) from unnest(array['recipient', 'second']) k;

insert into fx values ('s_then_r', pg_temp.new_fund('SThenR', 'recipient', 'second'));
select pg_temp.leave('second');
select is(pg_temp.state(pg_temp.fx('s_then_r')), 'recipient|none|Treasurer|clear|active', 'second person first: the slot empties, no review');
select pg_temp.leave('recipient');
select is(pg_temp.state(pg_temp.fx('s_then_r')), 'none|none|no role|review|active', 'then the recipient: no recipient');
insert into public.group_members (org_id, group_id, profile_id)
  select pg_temp.fx('org'), pg_temp.fx('group'), pg_temp.fx(k) from unnest(array['recipient', 'second']) k;

-- A membership moved to another group counts as leaving this one.
insert into fx values ('moved', pg_temp.new_fund('Moved', 'member', 'second'));
update public.group_members set group_id = pg_temp.fx('group2')
  where group_id = pg_temp.fx('group') and profile_id = pg_temp.fx('member');
select is(pg_temp.state(pg_temp.fx('moved')), 'second|none|no role|review|active', 'a membership moved away counts as leaving');
update public.group_members set group_id = pg_temp.fx('group')
  where group_id = pg_temp.fx('group2') and profile_id = pg_temp.fx('member');

-- ── The triggers aren't refused by the rules they enforce ───────────────────
insert into fx values ('by_leader', pg_temp.new_fund('ByLeader', 'recipient', 'second')),
                      ('by_leader2', pg_temp.new_fund('ByLeader2', 'recipient'));
select is(
  pg_temp.attempt('leader', format('delete from public.group_members where group_id = %L and profile_id = %L', pg_temp.fx('group'), pg_temp.fx('recipient'))),
  'rows:1', 'a leader removes a recipient');
select is(pg_temp.state(pg_temp.fx('by_leader')), 'second|none|no role|review|active', 'and the fund passes on under the leader''s session');
select is(pg_temp.state(pg_temp.fx('by_leader2')), 'none|none|no role|review|active', 'or is left with no recipient');
insert into public.group_members (org_id, group_id, profile_id) values (pg_temp.fx('org'), pg_temp.fx('group'), pg_temp.fx('recipient'));

insert into fx values ('by_admin', pg_temp.new_fund('ByAdmin', 'recipient', 'second'));
select is(
  pg_temp.attempt('church_admin', format('delete from public.group_members where group_id = %L and profile_id = %L', pg_temp.fx('group'), pg_temp.fx('recipient'))),
  'rows:1', 'a church admin who doesn''t lead the group removes a recipient');
select is(pg_temp.state(pg_temp.fx('by_admin')), 'second|none|no role|review|active', 'and is not refused by the leader rule');
insert into public.group_members (org_id, group_id, profile_id) values (pg_temp.fx('org'), pg_temp.fx('group'), pg_temp.fx('recipient'));

-- ── A deleted profile ───────────────────────────────────────────────────────
create function pg_temp.fresh_person(_key text) returns void language plpgsql as $$
begin
  insert into fx values (_key, pg_temp.new_person(pg_temp.fx('org'), _key || '@funds.test'));
  insert into public.group_members (org_id, group_id, profile_id)
    values (pg_temp.fx('org'), pg_temp.fx('group'), pg_temp.fx(_key));
end $$;

select pg_temp.fresh_person('gone1');
select pg_temp.fresh_person('gone2');
insert into fx values ('pd_promote', pg_temp.new_fund('PdPromote', 'gone1', 'second')),
                      ('pd_alone', pg_temp.new_fund('PdAlone', 'gone1')),
                      ('pd_second', pg_temp.new_fund('PdSecond', 'member', 'gone1')),
                      ('pd_self', pg_temp.new_fund('PdSelf', 'gone1', 'gone1'));
delete from auth.users where id = pg_temp.fx('gone1');
select is(pg_temp.state(pg_temp.fx('pd_promote')), 'second|none|no role|review|active', 'profile deleted: the second person takes over');
select is(pg_temp.state(pg_temp.fx('pd_alone')), 'none|none|no role|review|active', 'profile deleted with no second person: no recipient');
select is(pg_temp.methods(pg_temp.fx('pd_alone')), 1::bigint, 'and the fund keeps its payment methods');
select is(pg_temp.state(pg_temp.fx('pd_second')), 'member|none|Treasurer|clear|active', 'second person''s profile deleted: the slot empties');
select is(pg_temp.state(pg_temp.fx('pd_self')), 'none|none|no role|review|active', 'someone on both slots is not promoted over themself');
select is((select org_id from public.giving_funds where id = pg_temp.fx('pd_alone')), pg_temp.fx('org'),
  'the foreign key leaves org_id alone');

-- The foreign key alone, without the membership trigger having run first: the
-- two can fire in either order for one delete.
alter table public.group_members disable trigger group_members_leave_funds;
select pg_temp.fresh_person('gone3');
select pg_temp.fresh_person('gone4');
insert into fx values ('fk_promote', pg_temp.new_fund('FkPromote', 'gone3', 'second')),
                      ('fk_alone', pg_temp.new_fund('FkAlone', 'gone3')),
                      ('fk_second', pg_temp.new_fund('FkSecond', 'member', 'gone3')),
                      ('fk_both', pg_temp.new_fund('FkBoth', 'gone4', 'gone2'));
delete from auth.users where id = pg_temp.fx('gone3');
alter table public.group_members enable trigger group_members_leave_funds;
select is(pg_temp.state(pg_temp.fx('fk_promote')), 'second|none|no role|review|active', 'through the foreign key alone: the second person takes over');
select is(pg_temp.state(pg_temp.fx('fk_alone')), 'none|none|no role|review|active', 'through the foreign key alone: no recipient');
select is(pg_temp.state(pg_temp.fx('fk_second')), 'member|none|Treasurer|clear|active', 'through the foreign key alone: the slot empties');

-- Both people's profiles in one statement.
delete from auth.users where id in (pg_temp.fx('gone4'), pg_temp.fx('gone2'));
select is(pg_temp.state(pg_temp.fx('fk_both')), 'none|none|no role|review|active', 'both profiles deleted in one statement: no recipient');
select is(pg_temp.methods(pg_temp.fx('fk_both')), 1::bigint, 'and the fund stays');

-- delete_person(), once for each of the two people, in one transaction.
select pg_temp.fresh_person('dp1');
select pg_temp.fresh_person('dp2');
insert into fx values ('dp_promote', pg_temp.new_fund('DpPromote', 'dp1', 'second')),
                      ('dp_both', pg_temp.new_fund('DpBoth', 'dp1', 'dp2'));
select lives_ok(format('select public.delete_person(%L, %L)', pg_temp.fx('dp1'), pg_temp.fx('org')), 'delete_person() runs for the recipient');
select is(pg_temp.state(pg_temp.fx('dp_promote')), 'second|none|no role|review|active', 'delete_person(): the second person takes over and it isn''t retired');
select is(pg_temp.state(pg_temp.fx('dp_both')), 'dp2|none|no role|review|active', 'delete_person(): both still in the group until the second goes');
select lives_ok(format('select public.delete_person(%L, %L)', pg_temp.fx('dp2'), pg_temp.fx('org')), 'delete_person() runs for the second person');
select is(pg_temp.state(pg_temp.fx('dp_both')), 'none|none|no role|review|active', 'delete_person() of both: no recipient, never deleted');
select is(pg_temp.methods(pg_temp.fx('dp_both')), 1::bigint, 'with its payment methods');

-- ── Confirming and assigning, under each giving_manage_mode ─────────────────
create function pg_temp.set_flag_sql(_fund text) returns text language sql stable as $$
  select format('update public.giving_funds set needs_review = false where id = %L', pg_temp.fx(_fund));
$$;
create function pg_temp.assign_sql(_fund text, _to text) returns text language sql stable as $$
  select format('update public.giving_funds set steward_id = %L where id = %L', pg_temp.fx(_to), pg_temp.fx(_fund));
$$;

do $$
declare
  _mode text;
begin
  foreach _mode in array array['stewards', 'admins'] loop
    perform pg_temp.set_mode(_mode);
    insert into fx values
      ('c_' || _mode, pg_temp.new_fund('Confirm' || _mode, 'recipient', 'member')),
      ('n_' || _mode, pg_temp.new_fund('NoRecipient' || _mode, 'recipient'));
  end loop;
end $$;

-- The promoted person below is `member`, who leads no group. Each fund loses
-- `recipient` first; a rejoin leaves the promoted fund flagged.
select pg_temp.leave('recipient');

select pg_temp.set_mode('stewards');
select is(pg_temp.attempt('member', pg_temp.set_flag_sql('c_stewards')), '42501',
  'stewards mode: a promoted recipient can''t clear their own flag by a direct write');
select is(pg_temp.state(pg_temp.fx('c_stewards')), 'member|none|no role|review|active', 'and the flag stays');
select is(pg_temp.attempt('member', format('update public.giving_funds set is_active = true, name = ''Edited'' where id = %L', pg_temp.fx('c_stewards'))), 'rows:1',
  'stewards mode: they can still edit their own fund, and a reopen writes is_active');
select is(pg_temp.state(pg_temp.fx('c_stewards')), 'member|none|no role|review|active', 'which leaves it flagged');
select is(pg_temp.attempt('member', format('update public.giving_fund_methods set custom_handle = ''@fixed'' where fund_id = %L', pg_temp.fx('c_stewards'))), 'rows:1',
  'stewards mode: they can correct the payment methods');
select is(pg_temp.attempt('member', pg_temp.assign_sql('n_stewards', 'member')), 'rows:0',
  'stewards mode: nobody but a leader assigns a fund with no recipient, even to themself');
select is(pg_temp.attempt('second', pg_temp.assign_sql('n_stewards', 'member')), 'rows:0',
  'stewards mode: a member can''t assign it to someone else');
select is(pg_temp.state(pg_temp.fx('n_stewards')), 'none|none|no role|review|active', 'and it still has no recipient');
select is(pg_temp.attempt('member', format('update public.giving_fund_methods set custom_handle = ''@x'' where fund_id = %L', pg_temp.fx('n_stewards'))), 'rows:0',
  'stewards mode: nor do they get its payment methods');

select pg_temp.set_mode('admins');
select is(pg_temp.attempt('member', pg_temp.set_flag_sql('c_admins')), 'rows:0',
  'admins mode: a promoted recipient has no write on the fund at all');
select is(pg_temp.state(pg_temp.fx('c_admins')), 'member|none|no role|review|active', 'and the flag stays');
select is(pg_temp.attempt('member', pg_temp.assign_sql('n_admins', 'member')), 'rows:0',
  'admins mode: only a leader assigns a fund with no recipient');
select is(pg_temp.state(pg_temp.fx('n_admins')), 'none|none|no role|review|active', 'and it still has no recipient');

-- Leading the group a fund moves to doesn't count: the flag belongs to the group that set it.
select pg_temp.set_mode('stewards');
insert into public.group_members (org_id, group_id, profile_id) values (pg_temp.fx('org'), pg_temp.fx('group'), pg_temp.fx('recipient'));
insert into fx values ('hop', pg_temp.new_fund('Hop', 'recipient', 'second'));
select pg_temp.leave('recipient');
select is(pg_temp.state(pg_temp.fx('hop')), 'second|none|no role|review|active', 'the second person, who leads another group, is promoted');
select is(pg_temp.attempt('second', format('update public.giving_funds set group_id = %L, needs_review = false where id = %L', pg_temp.fx('group2'), pg_temp.fx('hop'))), '42501',
  'leading another group doesn''t clear the flag by moving the fund there');
select is(pg_temp.state(pg_temp.fx('hop')), 'second|none|no role|review|active', 'the fund didn''t move or clear');

do $$
declare _mode text;
begin
  foreach _mode in array array['stewards', 'admins'] loop
    perform pg_temp.set_mode(_mode);
    if pg_temp.attempt('leader', pg_temp.set_flag_sql('n_' || _mode)) <> '23514' then
      raise exception 'a fund with no recipient was confirmed in % mode', _mode;
    end if;
    if pg_temp.attempt('church_admin', pg_temp.set_flag_sql('c_' || _mode)) <> 'rows:0' then
      raise exception 'a church admin outside the group confirmed a fund in % mode', _mode;
    end if;
    if pg_temp.attempt('leader2', pg_temp.set_flag_sql('c_' || _mode)) <> 'rows:0' then
      raise exception 'a leader of another group confirmed a fund in % mode', _mode;
    end if;
    if pg_temp.attempt('foreign', pg_temp.set_flag_sql('c_' || _mode)) <> 'rows:0' then
      raise exception 'someone from another church confirmed a fund in % mode', _mode;
    end if;
  end loop;
end $$;
select pass('in both modes: no recipient can''t be confirmed, and no church admin, other leader or other church can confirm');

-- The leader's own path, in both modes.
select pg_temp.set_mode('stewards');
select is(pg_temp.attempt('leader', format('update public.giving_funds set name = ''Saved'', steward_id = %L, co_steward_id = null where id = %L', pg_temp.fx('member'), pg_temp.fx('c_stewards'))), 'rows:1',
  'a leader''s save on a fund in review isn''t refused');
select is(pg_temp.state(pg_temp.fx('c_stewards')), 'member|none|no role|review|active', 'and saving alone doesn''t confirm it');
select is(pg_temp.attempt('leader', pg_temp.assign_sql('n_stewards', 'second')), 'rows:1', 'a leader assigns a recipient');
select is(pg_temp.state(pg_temp.fx('n_stewards')), 'second|none|no role|review|active', 'and the fund then needs review, not live');
select is(pg_temp.attempt('leader', pg_temp.set_flag_sql('c_stewards')), 'rows:1', 'a leader confirms');
select is(pg_temp.state(pg_temp.fx('c_stewards')), 'member|none|no role|clear|active', 'and a previously live fund is live again');

select pg_temp.set_mode('admins');
select is(pg_temp.attempt('leader', pg_temp.assign_sql('n_admins', 'second')), 'rows:1', 'admins mode: a leader assigns a recipient');
select is(pg_temp.attempt('leader', pg_temp.set_flag_sql('n_admins')), 'rows:1', 'admins mode: and confirms');
select is(pg_temp.state(pg_temp.fx('n_admins')), 'second|none|no role|clear|active', 'admins mode: the fund is live');
select pg_temp.set_mode('stewards');

-- A retired fund stays retired once confirmed.
insert into fx values ('retired2', pg_temp.new_fund('Retired2', 'member', 'second', false));
select pg_temp.leave('member');
select is(pg_temp.state(pg_temp.fx('retired2')), 'second|none|no role|review|retired', 'a retired fund needs review like any other');
select is(pg_temp.attempt('leader', pg_temp.set_flag_sql('retired2')), 'rows:1', 'a leader confirms it');
select is(pg_temp.state(pg_temp.fx('retired2')), 'second|none|no role|clear|retired', 'and it stays retired');
insert into public.group_members (org_id, group_id, profile_id) values (pg_temp.fx('org'), pg_temp.fx('group'), pg_temp.fx('member'));

-- ── Give is closed at the database ──────────────────────────────────────────
insert into public.group_members (org_id, group_id, profile_id) values (pg_temp.fx('org'), pg_temp.fx('group'), pg_temp.fx('recipient'));
insert into fx values ('read_review', pg_temp.new_fund('ReadReview', 'recipient', 'second')),
                      ('read_none', pg_temp.new_fund('ReadNone', 'recipient')),
                      ('read_live', pg_temp.new_fund('ReadLive', 'second'));
select pg_temp.leave('recipient');
create function pg_temp.fund_sql(_fund text) returns text language sql stable as $$
  select format('select 1 from public.giving_funds where id = %L', pg_temp.fx(_fund));
$$;
create function pg_temp.methods_sql(_fund text) returns text language sql stable as $$
  select format('select 1 from public.giving_fund_methods where fund_id = %L', pg_temp.fx(_fund));
$$;

select is(pg_temp.visible('member', pg_temp.fund_sql('read_live')), 1::bigint, 'non-vacuity: a member reads a live fund');
select is(pg_temp.visible('member', pg_temp.methods_sql('read_live')), 1::bigint, 'and its payment methods');
select is(pg_temp.visible('member', pg_temp.fund_sql('read_review')), 0::bigint, 'a member can''t read a fund in review');
select is(pg_temp.visible('member', pg_temp.methods_sql('read_review')), 0::bigint, 'or its payment methods');
select is(pg_temp.visible('member', pg_temp.fund_sql('read_none')), 0::bigint, 'a member can''t read a fund with no recipient');
select is(pg_temp.visible('member', pg_temp.methods_sql('read_none')), 0::bigint, 'or its payment methods');
select is(pg_temp.visible('second', pg_temp.fund_sql('read_review')), 1::bigint, 'the promoted recipient reads their fund');
select is(pg_temp.visible('second', pg_temp.methods_sql('read_review')), 1::bigint, 'and its payment methods, to correct them');
select is(pg_temp.visible('second', pg_temp.fund_sql('read_none')), 0::bigint, 'but not a fund with no recipient');
select is(pg_temp.visible('leader', pg_temp.fund_sql('read_review')), 1::bigint, 'a leader reads a fund in review');
select is(pg_temp.visible('leader', pg_temp.methods_sql('read_review')), 1::bigint, 'and its payment methods, before confirming');
select is(pg_temp.visible('leader', pg_temp.fund_sql('read_none')), 1::bigint, 'a leader reads a fund with no recipient');
select is(pg_temp.visible('leader', pg_temp.methods_sql('read_none')), 1::bigint, 'and its payment methods');
select is(pg_temp.visible('foreign', pg_temp.fund_sql('read_none')), 0::bigint, 'nobody in another church reads it');
select is(pg_temp.visible('leader2', pg_temp.fund_sql('read_live')), 0::bigint, 'nor does a leader of another group');

select is(pg_temp.attempt('leader', pg_temp.set_flag_sql('read_review')), 'rows:1', 'a leader confirms');
select is(pg_temp.visible('member', pg_temp.fund_sql('read_review')), 1::bigint, 'and members read the fund again');
select is(pg_temp.visible('member', pg_temp.methods_sql('read_review')), 1::bigint, 'and its payment methods');

-- ── The backfill ────────────────────────────────────────────────────────────
-- A stale row can't be written with the guard on, which is the point of it.
alter table public.giving_funds disable trigger giving_funds_keep_recipients_in_group;
insert into fx values
  ('bf_promote', pg_temp.new_fund('BfPromote', 'outside', 'second')),
  ('bf_alone', pg_temp.new_fund('BfAlone', 'outside')),
  ('bf_both', pg_temp.new_fund('BfBoth', 'outside', 'leader2')),
  ('bf_retired', pg_temp.new_fund('BfRetired', 'outside', 'second', false)),
  ('bf_second', pg_temp.new_fund('BfSecond', 'second', 'outside')),
  ('bf_clean', pg_temp.new_fund('BfClean', 'second', 'leader'));
alter table public.giving_funds enable trigger giving_funds_keep_recipients_in_group;

select results_eq('select promoted, no_recipient, second_person_removed from public.giving_funds_apply_recipient_rules()',
  $$ values (2::bigint, 2::bigint, 1::bigint) $$, 'the backfill counts what it changed');
select is(pg_temp.state(pg_temp.fx('bf_promote')), 'second|none|no role|review|active', 'recipient outside the group: the second person takes over');
select is(pg_temp.state(pg_temp.fx('bf_alone')), 'none|none|no role|review|active', 'no second person: no recipient');
select is(pg_temp.methods(pg_temp.fx('bf_alone')), 1::bigint, 'and the payment methods stay');
select is(pg_temp.state(pg_temp.fx('bf_both')), 'none|none|no role|review|active', 'both outside the group: no recipient');
select is(pg_temp.state(pg_temp.fx('bf_retired')), 'second|none|no role|review|retired', 'a retired fund stays retired');
select is(pg_temp.state(pg_temp.fx('bf_second')), 'second|none|Treasurer|clear|active', 'second person outside the group: the slot empties, no review');
select is(pg_temp.state(pg_temp.fx('bf_clean')), 'second|leader|Treasurer|clear|active', 'a fund already in order is untouched');

select results_eq('select promoted, no_recipient, second_person_removed from public.giving_funds_apply_recipient_rules()',
  $$ values (0::bigint, 0::bigint, 0::bigint) $$, 'run again, it changes nothing');
select is(pg_temp.state(pg_temp.fx('bf_alone')), 'none|none|no role|review|active', 'and a fund it already paused stays paused');

-- ── A person the pickers can't offer ────────────────────────────────────────
insert into fx values
  ('pending', pg_temp.new_person(pg_temp.fx('org'), 'pending@funds.test', 'pending')),
  ('unlisted', pg_temp.new_person(pg_temp.fx('org'), 'unlisted@funds.test')),
  ('p_recipient', pg_temp.new_person(pg_temp.fx('org'), 'p_recipient@funds.test')),
  ('u_recipient', pg_temp.new_person(pg_temp.fx('org'), 'u_recipient@funds.test')),
  ('late_pending', pg_temp.new_person(pg_temp.fx('org'), 'late_pending@funds.test'));
update public.profiles set is_unlisted = true where id = pg_temp.fx('unlisted');
insert into public.group_members (org_id, group_id, profile_id)
select pg_temp.fx('org'), pg_temp.fx('group'), pg_temp.fx(k)
from unnest(array['pending', 'unlisted', 'p_recipient', 'u_recipient', 'late_pending']) k;

select is(pg_temp.attempt('leader', pg_temp.insert_sql('pending', null)), '23514',
  'an insert naming a pending recipient in the group is refused');
select is(pg_temp.attempt('leader', pg_temp.insert_sql('member', 'pending')), '23514',
  'an insert naming a pending second person in the group is refused');

insert into fx values
  ('to_pending', pg_temp.new_fund('ToPending', 'p_recipient', 'late_pending')),
  ('to_unlisted', pg_temp.new_fund('ToUnlisted', 'u_recipient', 'unlisted')),
  ('stays_named', pg_temp.new_fund('StaysNamed', 'member', 'late_pending'));
update public.profiles set role = 'pending' where id = pg_temp.fx('late_pending');

select is(
  pg_temp.attempt('leader', format('update public.giving_funds set name = ''z'' where id = %L', pg_temp.fx('stays_named'))),
  'rows:1', 'an edit that doesn''t name them is not refused for someone already on the fund');
select is(
  pg_temp.attempt('leader', format('update public.giving_funds set steward_id = %L where id = %L', pg_temp.fx('late_pending'), pg_temp.fx('stays_named'))),
  '23514', 'but they can''t be moved into the other slot');

select pg_temp.leave('p_recipient');
select is(pg_temp.state(pg_temp.fx('to_pending')), 'none|none|no role|review|active',
  'recipient leaves with a pending second person: nobody is promoted and the slot empties');

select pg_temp.leave('u_recipient');
select is(pg_temp.state(pg_temp.fx('to_unlisted')), 'unlisted|none|no role|review|active',
  'an unlisted second person is a member of the group, so they take over and it needs review');

alter table public.giving_funds disable trigger giving_funds_keep_recipients_in_group;
insert into fx values ('bf_pending', pg_temp.new_fund('BfPending', 'outside', 'late_pending'));
alter table public.giving_funds enable trigger giving_funds_keep_recipients_in_group;
select results_eq('select promoted, no_recipient, second_person_removed from public.giving_funds_apply_recipient_rules()',
  $$ values (0::bigint, 1::bigint, 0::bigint) $$, 'the backfill counts a fund with a pending second person as having no recipient');
select is(pg_temp.state(pg_temp.fx('bf_pending')), 'none|none|no role|review|active',
  'and doesn''t promote them');

-- The removal side of the race needs a second connection; what can be seen from
-- one is that the row carries this transaction's lock once the guard has read it.
insert into fx values ('locked', pg_temp.new_person(pg_temp.fx('org'), 'locked@funds.test'));
insert into public.group_members (org_id, group_id, profile_id)
values (pg_temp.fx('org'), pg_temp.fx('group'), pg_temp.fx('locked'));
select is(
  (select xmax::text from public.group_members
    where group_id = pg_temp.fx('group') and profile_id = pg_temp.fx('locked')),
  '0', 'non-vacuity: nothing holds the membership row before a write names them');
update public.giving_funds set co_steward_id = pg_temp.fx('locked') where id = pg_temp.fx('to_unlisted');
select is(
  (select xmax::text from public.group_members
    where group_id = pg_temp.fx('group') and profile_id = pg_temp.fx('locked')),
  pg_current_xact_id()::text, 'naming a person locks their membership row until the write commits');

select * from finish();
rollback;
