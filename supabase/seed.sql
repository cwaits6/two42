-- Local development fixtures, applied by `supabase start` / `supabase db
-- reset`. The guard below refuses any database that is not the CLI's local
-- stack, so `supabase db push --include-seed` against a linked project fails
-- before a single login is inserted.
--
-- Tiers are named after what they are so a screen always says which level it
-- is showing: the org is "Sample Organization", its groups are "Group A",
-- "Group B" and "Group C". Every surname is invented and every email is on
-- the reserved example.test domain — nothing here is a real person.
--
-- Accounts (all sign in with password123):
--   admin@local.dev                 org admin, leads Group A, member of Group B
--   <first>.<surname>@example.test  one per adult listed with an account below

-- Only the CLI's local stack runs on its published default JWT secret; a
-- hosted project always has its own.
DO $$
BEGIN
  IF current_setting('app.settings.jwt_secret', true)
     IS DISTINCT FROM 'super-secret-jwt-token-with-at-least-32-characters-long' THEN
    RAISE EXCEPTION 'seed.sql holds well-known development logins and only runs on the local Supabase stack';
  END IF;
END $$;

-- ── Organization ────────────────────────────────────────────────────────────

update public.organizations
set name = 'Sample Organization',
    branding = branding || jsonb_build_object('display_name', 'Sample Organization')
where id = '00000000-0000-0000-0000-000000000001';

-- ── Admin ───────────────────────────────────────────────────────────────────

-- handle_new_user() is fail-closed — a signup with no approved access request
-- or family invite raises. Seed the approval first so the trigger resolves
-- the admin into the default org.
INSERT INTO public.access_requests (org_id, name, email, status, reviewed_at)
SELECT '00000000-0000-0000-0000-000000000001', 'Local Admin', 'admin@local.dev', 'approved', now()
WHERE NOT EXISTS (
  -- Scoped to the default org and case-insensitive (GoTrue lowercases auth
  -- emails). An approved request for this email in ANOTHER org must not
  -- suppress the seed row — the trigger would then resolve the admin into
  -- that org; with both rows present it fails loudly (TN002) instead.
  SELECT 1 FROM public.access_requests
  WHERE org_id = '00000000-0000-0000-0000-000000000001'
    AND lower(email) = lower('admin@local.dev')
    AND status = 'approved'
);

INSERT INTO auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at,
  confirmation_token,
  recovery_token,
  email_change,
  email_change_token_new,
  email_change_token_current,
  email_change_confirm_status,
  phone,
  phone_change,
  phone_change_token,
  raw_app_meta_data,
  raw_user_meta_data
) VALUES (
  'a0000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'admin@local.dev',
  crypt('password123', gen_salt('bf', 10)),
  now(),
  now(),
  now(),
  '',
  '',
  '',
  '',
  '',
  0,
  '',
  '',
  '',
  '{"provider": "email", "providers": ["email"]}',
  '{"full_name": "Local Admin"}'
)
ON CONFLICT (id) DO NOTHING;

-- The handle_new_user trigger auto-creates the profile with role 'pending',
-- so we just update it to admin
UPDATE public.profiles
SET role = 'admin', setup_completed = true, approved_at = now()
WHERE id = 'a0000000-0000-0000-0000-000000000001';

-- ── Groups ──────────────────────────────────────────────────────────────────

-- The group-model migration gave the org one group before this file runs;
-- that one becomes Group A so the admin's leadership and the team below
-- stay attached to it.
UPDATE public.groups
SET name = 'Group A', description = 'Meets Thursday evenings.'
WHERE id = (
  SELECT id FROM public.groups
  WHERE org_id = '00000000-0000-0000-0000-000000000001'
  ORDER BY created_at
  LIMIT 1
);

INSERT INTO public.groups (id, org_id, name, description)
VALUES
  ('c0000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000001', 'Group B', 'Meets Tuesday evenings.'),
  ('c0000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-000000000001', 'Group C', 'Meets Sunday afternoons.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.group_members (org_id, group_id, profile_id, role)
SELECT g.org_id, g.id, 'a0000000-0000-0000-0000-000000000001',
       CASE WHEN g.name = 'Group A' THEN 'leader' ELSE 'member' END
FROM public.groups g
WHERE g.org_id = '00000000-0000-0000-0000-000000000001'
  AND g.name IN ('Group A', 'Group B')
ON CONFLICT (group_id, profile_id) DO UPDATE
  SET role = excluded.role;

-- Starter team under Group A so the serving flow is testable locally.
-- Deployments create their own teams at /admin/groups — provisioning seeds
-- none.
INSERT INTO public.teams (id, org_id, group_id, name, description, color, icon, display_order, is_serving_role)
SELECT 'b0000000-0000-0000-0000-000000000001', g.org_id, g.id, 'Serving Team', 'Signs up to serve on Sundays', '#7C9885', 'hands', 0, true
FROM public.groups g
WHERE g.org_id = '00000000-0000-0000-0000-000000000001'
  AND g.name = 'Group A'
-- Refresh the mutable fixture fields on re-seed so a stale local row picks
-- up seed changes; id, org_id and group_id are preserved, and a same-id row
-- that somehow belongs to another org is left untouched.
ON CONFLICT (id) DO UPDATE
  SET name = excluded.name,
      description = excluded.description,
      color = excluded.color,
      icon = excluded.icon,
      display_order = excluded.display_order,
      is_serving_role = excluded.is_serving_role
  WHERE teams.org_id = excluded.org_id;

-- ── Households ──────────────────────────────────────────────────────────────

-- One row per household. `groups` lists the groups every adult with an
-- account joins; the primary adult leads the group named in `leads`.
CREATE TEMP TABLE seed_households (
  seq           serial PRIMARY KEY,
  surname       text NOT NULL UNIQUE,
  address_line1 text,
  city          text,
  state         text,
  postal_code   text,
  phone_home    text,
  anniversary   date,
  groups        text[] NOT NULL,
  leads         text
);

INSERT INTO seed_households (surname, address_line1, city, state, postal_code, phone_home, anniversary, groups, leads) VALUES
  ('Sampleton',   '101 Example Street',  'Springfield', 'IL', '62701', '555-0101', '2012-06-09', '{Group A}',         NULL),
  ('Fakeworth',   '202 Example Avenue',  'Springfield', 'IL', '62701', '555-0102', '2015-09-20', '{Group A}',         NULL),
  ('Placeholder', '303 Example Lane',    'Springfield', 'IL', '62702', NULL,       NULL,         '{Group A}',         NULL),
  ('Testwell',    '404 Example Court',   'Springfield', 'IL', '62702', '555-0104', '2004-05-15', '{Group A}',         NULL),
  ('Mockingham',  '505 Example Drive',   'Springfield', 'IL', '62703', '555-0105', '2009-10-03', '{Group A,Group B}', NULL),
  ('Dummyfield',  '606 Example Road',    'Springfield', 'IL', '62703', '555-0106', '2011-04-22', '{Group B}',         'Group B'),
  ('Seedly',      '707 Example Place',   'Springfield', 'IL', '62704', '555-0107', '2018-08-11', '{Group B}',         NULL),
  ('Fixtureton',  '808 Example Circle',  'Springfield', 'IL', '62704', '555-0108', NULL,         '{Group B}',         NULL),
  ('Loremsworth', '909 Example Way',     'Springfield', 'IL', '62705', '555-0109', '2016-02-14', '{Group B,Group C}', NULL),
  ('Demoski',     '1010 Example Trail',  'Springfield', 'IL', '62705', NULL,       NULL,         '{Group C}',         'Group C'),
  ('Stubbins',    '1111 Example Parkway','Springfield', 'IL', '62706', '555-0111', '2010-07-31', '{Group C}',         NULL),
  ('Nullington',  '1212 Example Terrace','Springfield', 'IL', '62706', '555-0112', '1961-06-24', '{Group C}',         NULL);

-- One row per person. Adults with an account get an auth user and profile;
-- everyone else is a family_members row on the household.
CREATE TEMP TABLE seed_people (
  seq          serial PRIMARY KEY,
  surname      text NOT NULL REFERENCES seed_households (surname),
  first_name   text NOT NULL,
  relationship text NOT NULL,
  has_account  boolean NOT NULL,
  birth_month  smallint,
  birth_day    smallint,
  birth_year   smallint
);

INSERT INTO seed_people (surname, first_name, relationship, has_account, birth_month, birth_day, birth_year) VALUES
  ('Sampleton',   'Ava',     'primary', true,  3,  14, 1986),
  ('Sampleton',   'Noah',    'spouse',  true,  11, 2,  1984),
  ('Sampleton',   'Lily',    'child',   false, 7,  19, 2016),
  ('Sampleton',   'Max',     'child',   false, 1,  8,  2019),
  ('Fakeworth',   'Mia',     'primary', true,  5,  30, 1990),
  ('Fakeworth',   'Liam',    'spouse',  false, 8,  12, 1989),
  ('Fakeworth',   'Ella',    'child',   false, 12, 25, 2018),
  ('Placeholder', 'Ethan',   'primary', true,  9,  9,  1995),
  ('Testwell',    'Grace',   'primary', true,  2,  27, 1978),
  ('Testwell',    'Owen',    'spouse',  true,  6,  15, 1976),
  ('Mockingham',  'Henry',   'primary', true,  4,  4,  1982),
  ('Mockingham',  'Chloe',   'spouse',  true,  10, 21, 1983),
  ('Mockingham',  'Jack',    'child',   false, 3,  3,  2012),
  ('Mockingham',  'Sophie',  'child',   false, 8,  30, 2014),
  ('Mockingham',  'Ben',     'child',   false, 11, 11, 2017),
  ('Dummyfield',  'Zoe',     'primary', true,  7,  7,  1988),
  ('Dummyfield',  'Caleb',   'spouse',  true,  1,  23, 1987),
  ('Seedly',      'Isaac',   'primary', true,  12, 1,  1992),
  ('Seedly',      'Nora',    'spouse',  false, 4,  18, 1993),
  ('Fixtureton',  'Ruth',    'primary', true,  10, 5,  1941),
  ('Loremsworth', 'Leo',     'primary', true,  6,  6,  1985),
  ('Loremsworth', 'Hannah',  'spouse',  true,  9,  28, 1986),
  ('Loremsworth', 'Eli',     'child',   false, 2,  2,  2020),
  ('Demoski',     'Amelia',  'primary', true,  8,  8,  1979),
  ('Stubbins',    'Oliver',  'primary', true,  5,  5,  1981),
  ('Stubbins',    'Ivy',     'spouse',  true,  3,  31, 1983),
  ('Stubbins',    'June',    'child',   false, 6,  21, 2013),
  ('Stubbins',    'Theo',    'child',   false, 10, 10, 2015),
  ('Nullington',  'Walter',  'primary', true,  1,  1,  1938),
  ('Nullington',  'Edith',   'spouse',  false, 12, 12, 1940);

DO $$
DECLARE
  _org CONSTANT uuid := '00000000-0000-0000-0000-000000000001';
  _household RECORD;
  _person RECORD;
  _family_id uuid;
  _user_id uuid;
  _email text;
  _group_name text;
BEGIN
  FOR _household IN SELECT * FROM seed_households ORDER BY seq LOOP
    _family_id := ('f0000000-0000-0000-0000-' || lpad(_household.seq::text, 12, '0'))::uuid;

    INSERT INTO public.family_units (id, org_id, family_name, address_line1, city, state, postal_code, phone_home, anniversary)
    VALUES (_family_id, _org, _household.surname, _household.address_line1, _household.city, _household.state,
            _household.postal_code, _household.phone_home, _household.anniversary)
    ON CONFLICT (id) DO NOTHING;

    FOR _person IN SELECT * FROM seed_people WHERE surname = _household.surname ORDER BY seq LOOP
      IF NOT _person.has_account THEN
        INSERT INTO public.family_members (id, org_id, family_id, first_name, last_name, relationship, is_class_member, birth_month, birth_day, birth_year)
        VALUES (('d0000000-0000-0000-0000-' || lpad(_person.seq::text, 12, '0'))::uuid, _org, _family_id,
                _person.first_name, _household.surname, _person.relationship, _person.relationship <> 'child',
                _person.birth_month, _person.birth_day, _person.birth_year)
        ON CONFLICT (id) DO NOTHING;
        CONTINUE;
      END IF;

      _user_id := ('a0000000-0000-0000-0000-' || lpad((100 + _person.seq)::text, 12, '0'))::uuid;
      _email := lower(_person.first_name || '.' || _household.surname || '@example.test');

      INSERT INTO public.access_requests (org_id, name, email, status, approved_role, reviewed_at)
      SELECT _org, _person.first_name || ' ' || _household.surname, _email, 'approved', 'member', now()
      WHERE NOT EXISTS (
        SELECT 1 FROM public.access_requests
        WHERE org_id = _org AND lower(email) = _email AND status = 'approved'
      );

      INSERT INTO auth.users (
        id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
        created_at, updated_at, confirmation_token, recovery_token, email_change,
        email_change_token_new, email_change_token_current, email_change_confirm_status,
        phone, phone_change, phone_change_token, raw_app_meta_data, raw_user_meta_data
      ) VALUES (
        _user_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', _email,
        crypt('password123', gen_salt('bf', 10)), now(),
        now(), now(), '', '', '',
        '', '', 0,
        NULL, '', '', '{"provider": "email", "providers": ["email"]}',
        jsonb_build_object('full_name', _person.first_name || ' ' || _household.surname)
      )
      ON CONFLICT (id) DO NOTHING;

      UPDATE public.profiles
      SET family_id = _family_id,
          relationship = _person.relationship,
          phone_mobile = '555-01' || lpad(_person.seq::text, 2, '0'),
          birth_month = _person.birth_month,
          birth_day = _person.birth_day,
          birth_year = _person.birth_year,
          setup_completed = true,
          approved_at = now()
      WHERE id = _user_id AND org_id = _org;

      FOREACH _group_name IN ARRAY _household.groups LOOP
        INSERT INTO public.group_members (org_id, group_id, profile_id, role)
        SELECT _org, g.id, _user_id,
               CASE WHEN _person.relationship = 'primary' AND g.name = _household.leads THEN 'leader' ELSE 'member' END
        FROM public.groups g
        WHERE g.org_id = _org AND g.name = _group_name
        ON CONFLICT (group_id, profile_id) DO UPDATE
          SET role = excluded.role;
      END LOOP;
    END LOOP;
  END LOOP;
END $$;

DROP TABLE seed_people;
DROP TABLE seed_households;

-- ── Events, announcements, prayer ───────────────────────────────────────────

-- The two meetings recur without end so the dashboard has a next meeting no
-- matter how long ago the seed ran. Times are local to siteConfig.timeZone.
INSERT INTO public.events (id, org_id, title, description, location, start_time, end_time, created_by,
                           recurrence_frequency, recurrence_interval, recurrence_end_mode,
                           meeting_url, meeting_id, meeting_passcode)
VALUES
  ('e0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001',
   'Weekly Group Meeting', 'Study and prayer. Bring your questions from this week''s reading.',
   'The Sampleton home',
   ((date_trunc('week', now() AT TIME ZONE 'America/New_York')::date + 3) + time '19:00') AT TIME ZONE 'America/New_York',
   ((date_trunc('week', now() AT TIME ZONE 'America/New_York')::date + 3) + time '20:30') AT TIME ZONE 'America/New_York',
   'a0000000-0000-0000-0000-000000000001', 'weekly', 1, 'never',
   'https://example.zoom.us/j/00000000000', '000 0000 0000', '000000'),
  ('e0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001',
   'Sunday Class', 'Teaching hour before the service.', 'Room 242',
   ((date_trunc('week', now() AT TIME ZONE 'America/New_York')::date + 6) + time '09:30') AT TIME ZONE 'America/New_York',
   ((date_trunc('week', now() AT TIME ZONE 'America/New_York')::date + 6) + time '10:30') AT TIME ZONE 'America/New_York',
   'a0000000-0000-0000-0000-000000000001', 'weekly', 1, 'never',
   NULL, NULL, NULL),
  ('e0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001',
   'Potluck Dinner', 'Bring a dish to share. Drinks and plates provided.', 'Fellowship Hall',
   ((current_date + 16) + time '18:00') AT TIME ZONE 'America/New_York',
   ((current_date + 16) + time '20:00') AT TIME ZONE 'America/New_York',
   'a0000000-0000-0000-0000-000000000001', NULL, 1, NULL,
   NULL, NULL, NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.rsvps (org_id, event_id, user_id, status)
SELECT org_id, 'e0000000-0000-0000-0000-000000000003', id,
       CASE WHEN row_number() OVER (ORDER BY id) <= 7 THEN 'yes' ELSE 'maybe' END
FROM public.profiles
WHERE org_id = '00000000-0000-0000-0000-000000000001'
  AND email LIKE '%@example.test'
  AND relationship = 'primary'
ON CONFLICT (event_id, user_id) DO NOTHING;

INSERT INTO public.announcements (id, org_id, author_id, title, content, is_published, published_at)
VALUES
  ('a1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001',
   'Potluck sign-up is open',
   'RSVP on the calendar so we know how many tables to set. Main dishes are the biggest need this time.',
   true, now() - interval '2 days'),
  ('a1000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001',
   'Parking lot repaving next week',
   'The north lot is closed Monday through Wednesday. Use the street entrance and allow a few extra minutes.',
   true, now() - interval '6 days')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.prayer_requests (id, org_id, author_id, body, category, is_anonymous)
SELECT r.id, p.org_id, p.id, r.body, r.category, r.is_anonymous
FROM (VALUES
  ('b1000000-0000-0000-0000-000000000001'::uuid, 'zoe.dummyfield@example.test',
   'Ruth has a follow-up appointment Thursday after last month''s fall. Pray for a clear scan and steady steps.',
   'health', false),
  ('b1000000-0000-0000-0000-000000000002'::uuid, 'mia.fakeworth@example.test',
   'Grateful that the new job came through after a long search.',
   'thanksgiving', false),
  ('b1000000-0000-0000-0000-000000000003'::uuid, 'amelia.demoski@example.test',
   'Deciding whether to take a transfer out of state. Wisdom for the family.',
   'guidance', true)
) AS r (id, author_email, body, category, is_anonymous)
JOIN public.profiles p ON p.email = r.author_email
  AND p.org_id = '00000000-0000-0000-0000-000000000001'
ON CONFLICT (id) DO NOTHING;
