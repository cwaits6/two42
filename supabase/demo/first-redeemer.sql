-- Demo organization for product screenshots: First Redeemer Church, with
-- entirely fictional people. Every household, name, address and phone number
-- is invented, and every email is on the reserved example.test domain. The
-- org is created beside the test seed's "Sample Organization" and touches
-- none of its rows; re-running the script is a no-op for rows that exist.
--
-- Three groups, each with its own calendar:
--   Young Families        the group every screenshot shows: weekly Tuesday
--                         meeting with a Zoom link, upcoming events with
--                         RSVPs, three serving teams, announcements, prayer
--   Newlyweds             a monthly dinner
--   High School Parents   a weekly coffee
--
-- Sign-ins (password123 for both):
--   susan.anderson@example.test   org admin; leads Young Families and its
--                                 serving teams
--   karen.thompson@example.test   plain member of Young Families and High
--                                 School Parents; the member-view screenshots
--                                 are taken as her
-- Every other adult with an account signs in as <first>.<surname>@example.test
-- with the same password.
--
-- Apply through the shared local container (never a remote project):
--   docker exec -i supabase_db_small-group-hub \
--     psql -U postgres -d postgres -f - < supabase/demo/first-redeemer.sql

DO $$
DECLARE
  _org uuid;
  _household RECORD;
  _person RECORD;
  _family_id uuid;
  _user_id uuid;
  _email text;
  _group_name text;
  _susan uuid;
  _yf uuid; _nw uuid; _hs uuid;
  _yf_cal uuid; _nw_cal uuid; _hs_cal uuid;
  _tz CONSTANT text := 'America/New_York';
  _sunday date;
  _i int;
  _team_snacks uuid := 'de3c0000-0000-0000-0000-00000000b001';
  _team_setup  uuid := 'de3c0000-0000-0000-0000-00000000b002';
  _team_kids   uuid := 'de3c0000-0000-0000-0000-00000000b003';
  _fam uuid[];
BEGIN
  -- Only the CLI's local stack runs on its published default JWT secret; a
  -- hosted project always has its own. The check lives inside the one block
  -- that writes, so psql without ON_ERROR_STOP cannot run past it.
  IF current_setting('app.settings.jwt_secret', true)
     IS DISTINCT FROM 'super-secret-jwt-token-with-at-least-32-characters-long' THEN
    RAISE EXCEPTION 'first-redeemer.sql holds well-known development logins and only runs on the local Supabase stack';
  END IF;

  -- The demo's own group id is the rerun marker: a same-named organization
  -- that this script did not create is never adopted.
  SELECT org_id INTO _org FROM public.groups WHERE id = 'de3c0000-0000-0000-0000-00000000c001';
  IF _org IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.organizations WHERE id = _org AND name = 'First Redeemer Church'
  ) THEN
    RAISE EXCEPTION 'first-redeemer.sql: the demo group id belongs to another organization; refusing to write into it';
  END IF;
  IF _org IS NULL THEN
    _org := public.provision_organization('First Redeemer Church', 'susan.anderson@example.test');
  END IF;

  -- Groups
  INSERT INTO public.groups (id, org_id, name, description) VALUES
    ('de3c0000-0000-0000-0000-00000000c001', _org, 'Young Families', 'Tuesday evenings at the Andersons''. Kids welcome.'),
    ('de3c0000-0000-0000-0000-00000000c002', _org, 'Newlyweds', 'Second Sunday of the month over dinner.'),
    ('de3c0000-0000-0000-0000-00000000c003', _org, 'High School Parents', 'Thursday morning coffee during the school year.')
  ON CONFLICT (id) DO NOTHING;
  _yf := 'de3c0000-0000-0000-0000-00000000c001';
  _nw := 'de3c0000-0000-0000-0000-00000000c002';
  _hs := 'de3c0000-0000-0000-0000-00000000c003';

  INSERT INTO public.event_calendars (id, org_id, group_id, name) VALUES
    ('de3c0000-0000-0000-0000-00000000ca01', _org, _yf, 'Young Families'),
    ('de3c0000-0000-0000-0000-00000000ca02', _org, _nw, 'Newlyweds'),
    ('de3c0000-0000-0000-0000-00000000ca03', _org, _hs, 'High School Parents')
  ON CONFLICT (id) DO NOTHING;
  _yf_cal := 'de3c0000-0000-0000-0000-00000000ca01';
  _nw_cal := 'de3c0000-0000-0000-0000-00000000ca02';
  _hs_cal := 'de3c0000-0000-0000-0000-00000000ca03';

  -- Households and people
  CREATE TEMP TABLE demo_households (
    seq serial PRIMARY KEY, surname text UNIQUE NOT NULL, address_line1 text, city text, state text,
    postal_code text, phone_home text, anniversary date, groups text[] NOT NULL, leads text
  ) ON COMMIT DROP;
  INSERT INTO demo_households (surname, address_line1, city, state, postal_code, phone_home, anniversary, groups, leads) VALUES
    ('Anderson', '14 Maple Court',     'Springfield', 'IL', '62701', '555-0141', '2012-06-09', '{Young Families}',                     'Young Families'),
    ('Thompson', '220 Oak Street',     'Springfield', 'IL', '62701', '555-0142', '2006-09-23', '{Young Families,High School Parents}', NULL),
    ('Martin',   '31 Birch Lane',      'Springfield', 'IL', '62702', '555-0143', '2016-05-14', '{Young Families}',                     NULL),
    ('Clark',    '47 Willow Drive',    'Springfield', 'IL', '62702', '555-0144', '2026-06-14', '{Newlyweds}',                          'Newlyweds'),
    ('Walker',   '58 Cedar Avenue',    'Springfield', 'IL', '62703', NULL,       NULL,         '{Young Families}',                     NULL),
    ('Hall',     '63 Elm Place',       'Springfield', 'IL', '62703', '555-0146', '2026-03-21', '{Newlyweds}',                          NULL),
    ('Young',    '72 Pine Street',     'Springfield', 'IL', '62704', '555-0147', '2013-10-05', '{Young Families}',                     NULL),
    ('Scott',    '89 Spruce Road',     'Springfield', 'IL', '62704', '555-0148', '2004-08-28', '{High School Parents}',                'High School Parents'),
    ('King',     '105 Chestnut Court', 'Springfield', 'IL', '62705', '555-0149', '2011-04-16', '{Young Families}',                     NULL);

  CREATE TEMP TABLE demo_people (
    seq serial PRIMARY KEY, surname text NOT NULL REFERENCES demo_households (surname), first_name text NOT NULL,
    relationship text NOT NULL, has_account boolean NOT NULL, birth_month smallint, birth_day smallint, birth_year smallint
  ) ON COMMIT DROP;
  INSERT INTO demo_people (surname, first_name, relationship, has_account, birth_month, birth_day, birth_year) VALUES
    ('Anderson', 'Susan',    'primary', true,  3,  14, 1986),
    ('Anderson', 'Mark',     'spouse',  true,  11, 2,  1984),
    ('Anderson', 'Emma',     'child',   false, 7,  19, 2016),
    ('Anderson', 'Jack',     'child',   false, 1,  8,  2019),
    ('Thompson', 'John',     'primary', true,  5,  30, 1978),
    ('Thompson', 'Karen',    'spouse',  true,  8,  12, 1979),
    ('Thompson', 'Tyler',    'child',   false, 12, 3,  2009),
    ('Martin',   'Michael',  'primary', true,  9,  9,  1989),
    ('Martin',   'Lisa',     'spouse',  true,  2,  27, 1990),
    ('Martin',   'Olivia',   'child',   false, 6,  15, 2018),
    ('Martin',   'Noah',     'child',   false, 4,  4,  2026),
    ('Clark',    'Steve',    'primary', true,  10, 21, 1996),
    ('Clark',    'Amy',      'spouse',  true,  3,  3,  1997),
    ('Walker',   'Jennifer', 'primary', true,  8,  30, 1987),
    ('Walker',   'Sophia',   'child',   false, 11, 11, 2017),
    ('Hall',     'Brian',    'primary', true,  7,  7,  1995),
    ('Hall',     'Megan',    'spouse',  true,  1,  23, 1996),
    ('Young',    'Laura',    'primary', true,  12, 1,  1985),
    ('Young',    'Chris',    'spouse',  false, 4,  18, 1984),
    ('Young',    'Ava',      'child',   false, 10, 5,  2015),
    ('Young',    'Liam',     'child',   false, 6,  6,  2018),
    ('Scott',    'Kevin',    'primary', true,  9,  28, 1975),
    ('Scott',    'Michelle', 'spouse',  true,  2,  2,  1977),
    ('Scott',    'Ryan',     'child',   false, 8,  8,  2010),
    ('King',     'Rachel',   'primary', true,  5,  5,  1988),
    ('King',     'Daniel',   'spouse',  true,  3,  31, 1987),
    ('King',     'Grace',    'child',   false, 6,  21, 2014),
    ('King',     'Henry',    'child',   false, 10, 10, 2017);

  FOR _household IN SELECT * FROM demo_households ORDER BY seq LOOP
    _family_id := ('de3c0000-0000-0000-0000-00000000f' || lpad(_household.seq::text, 3, '0'))::uuid;
    INSERT INTO public.family_units (id, org_id, family_name, address_line1, city, state, postal_code, phone_home, anniversary)
    VALUES (_family_id, _org, _household.surname, _household.address_line1, _household.city, _household.state,
            _household.postal_code, _household.phone_home, _household.anniversary)
    ON CONFLICT (id) DO NOTHING;

    FOR _person IN SELECT * FROM demo_people WHERE surname = _household.surname ORDER BY seq LOOP
      IF NOT _person.has_account THEN
        INSERT INTO public.family_members (id, org_id, family_id, first_name, last_name, relationship, is_class_member, birth_month, birth_day, birth_year)
        VALUES (('de3c0000-0000-0000-0000-00000000d' || lpad(_person.seq::text, 3, '0'))::uuid, _org, _family_id,
                _person.first_name, _household.surname, _person.relationship, _person.relationship <> 'child',
                _person.birth_month, _person.birth_day, _person.birth_year)
        ON CONFLICT (id) DO NOTHING;
        CONTINUE;
      END IF;

      _user_id := ('de3c0000-0000-0000-0000-00000000a' || lpad(_person.seq::text, 3, '0'))::uuid;
      _email := lower(_person.first_name || '.' || _household.surname || '@example.test');
      IF _email = 'susan.anderson@example.test' THEN _susan := _user_id; END IF;

      -- The owner's approved request already exists from provisioning (role admin).
      INSERT INTO public.access_requests (org_id, name, email, status, approved_role, reviewed_at)
      SELECT _org, _person.first_name || ' ' || _household.surname, _email, 'approved', 'member', now()
      WHERE NOT EXISTS (
        SELECT 1 FROM public.access_requests WHERE org_id = _org AND lower(email) = _email AND status = 'approved'
      );

      INSERT INTO auth.users (
        id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
        created_at, updated_at, confirmation_token, recovery_token, email_change,
        email_change_token_new, email_change_token_current, email_change_confirm_status,
        phone, phone_change, phone_change_token, raw_app_meta_data, raw_user_meta_data
      ) VALUES (
        _user_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', _email,
        crypt('password123', gen_salt('bf', 10)), now(), now(), now(), '', '', '', '', '', 0,
        NULL, '', '', '{"provider": "email", "providers": ["email"]}',
        jsonb_build_object('full_name', _person.first_name || ' ' || _household.surname)
      )
      ON CONFLICT (id) DO NOTHING;

      UPDATE public.profiles
      SET family_id = _family_id, relationship = _person.relationship,
          phone_mobile = '555-02' || lpad(_person.seq::text, 2, '0'),
          birth_month = _person.birth_month, birth_day = _person.birth_day, birth_year = _person.birth_year,
          setup_completed = true, approved_at = now()
      WHERE id = _user_id AND org_id = _org;

      FOREACH _group_name IN ARRAY _household.groups LOOP
        INSERT INTO public.group_members (org_id, group_id, profile_id, role)
        SELECT _org, g.id, _user_id,
               CASE WHEN _person.relationship = 'primary' AND g.name = _household.leads THEN 'leader' ELSE 'member' END
        FROM public.groups g WHERE g.org_id = _org AND g.name = _group_name
        ON CONFLICT (group_id, profile_id) DO UPDATE SET role = excluded.role;
      END LOOP;
    END LOOP;
  END LOOP;

  -- Events
  INSERT INTO public.events (id, org_id, group_id, calendar_id, title, description, location, start_time, end_time, created_by,
                             recurrence_frequency, recurrence_interval, recurrence_end_mode, meeting_url, meeting_id, meeting_passcode)
  VALUES
    ('de3c0000-0000-0000-0000-00000000e001', _org, _yf, _yf_cal, 'Young Families Group',
     'Dinner together, then a short study. Kids are welcome — childcare is set up in the playroom.', 'The Anderson home',
     ((date_trunc('week', now() AT TIME ZONE _tz)::date + 1) + time '18:30') AT TIME ZONE _tz,
     ((date_trunc('week', now() AT TIME ZONE _tz)::date + 1) + time '20:00') AT TIME ZONE _tz,
     _susan, 'weekly', 1, 'never', 'https://example.zoom.us/j/00000000001', '000 0000 0001', '242424'),
    ('de3c0000-0000-0000-0000-00000000e002', _org, _yf, _yf_cal, 'Serve Day at the Food Pantry',
     'Sorting and packing for the Saturday distribution. Older kids can help.', 'Community Food Pantry, 400 Main Street',
     ((date_trunc('week', now() AT TIME ZONE _tz)::date + 12) + time '09:00') AT TIME ZONE _tz,
     ((date_trunc('week', now() AT TIME ZONE _tz)::date + 12) + time '11:30') AT TIME ZONE _tz,
     _susan, NULL, 1, NULL, NULL, NULL, NULL),
    ('de3c0000-0000-0000-0000-00000000e003', _org, _yf, _yf_cal, 'Fall Potluck',
     'Bring a dish to share. Drinks, plates and a bounce house for the kids are covered.', 'Fellowship Hall',
     ((date_trunc('week', now() AT TIME ZONE _tz)::date + 20) + time '17:00') AT TIME ZONE _tz,
     ((date_trunc('week', now() AT TIME ZONE _tz)::date + 20) + time '19:00') AT TIME ZONE _tz,
     _susan, NULL, 1, NULL, NULL, NULL, NULL),
    ('de3c0000-0000-0000-0000-00000000e004', _org, _yf, _yf_cal, 'Christmas Caroling',
     'Meet in the church parking lot. Hot chocolate after at the Thompsons''.', 'Church parking lot',
     (make_date(extract(year from now())::int, 12, 13) + time '18:00') AT TIME ZONE _tz,
     (make_date(extract(year from now())::int, 12, 13) + time '20:00') AT TIME ZONE _tz,
     _susan, NULL, 1, NULL, NULL, NULL, NULL),
    ('de3c0000-0000-0000-0000-00000000e005', _org, _nw, _nw_cal, 'Newlyweds Dinner',
     'Second Sunday of the month. This month at the Clarks''.', 'The Clark home',
     ((date_trunc('week', now() AT TIME ZONE _tz)::date + 13) + time '18:00') AT TIME ZONE _tz,
     ((date_trunc('week', now() AT TIME ZONE _tz)::date + 13) + time '20:00') AT TIME ZONE _tz,
     _susan, NULL, 1, NULL, NULL, NULL, NULL),
    ('de3c0000-0000-0000-0000-00000000e006', _org, _hs, _hs_cal, 'Parents'' Coffee',
     'Thursday mornings after drop-off.', 'The Corner Café',
     ((date_trunc('week', now() AT TIME ZONE _tz)::date + 3) + time '08:30') AT TIME ZONE _tz,
     ((date_trunc('week', now() AT TIME ZONE _tz)::date + 3) + time '09:30') AT TIME ZONE _tz,
     _susan, 'weekly', 1, 'never', NULL, NULL, NULL)
  ON CONFLICT (id) DO NOTHING;

  -- RSVPs: the whole group is coming Tuesday; most of it to the potluck.
  INSERT INTO public.rsvps (org_id, event_id, user_id, status)
  SELECT _org, 'de3c0000-0000-0000-0000-00000000e001', gm.profile_id, 'yes'
  FROM public.group_members gm WHERE gm.group_id = _yf AND gm.org_id = _org
  ON CONFLICT (event_id, user_id) DO NOTHING;
  INSERT INTO public.rsvps (org_id, event_id, user_id, status)
  SELECT _org, 'de3c0000-0000-0000-0000-00000000e003', gm.profile_id,
         CASE WHEN row_number() OVER (ORDER BY gm.profile_id) <= 7 THEN 'yes' ELSE 'maybe' END
  FROM public.group_members gm WHERE gm.group_id = _yf AND gm.org_id = _org
  ON CONFLICT (event_id, user_id) DO NOTHING;

  -- Serving teams in Young Families, with most of the coming Sundays covered.
  INSERT INTO public.teams (id, org_id, group_id, name, description, color, icon, display_order, is_serving_role, created_by) VALUES
    (_team_snacks, _org, _yf, 'Snacks',    'Brings snacks and coffee for Tuesday night', '#B85C38', 'utensils', 0, true, _susan),
    (_team_setup,  _org, _yf, 'Set-up',    'Chairs, tables and the playroom before 6',    '#7C9885', 'hands',    1, true, _susan),
    (_team_kids,   _org, _yf, 'Childcare', 'Watches the kids during the study',           '#E8A33D', 'heart',    2, true, _susan)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.serving_team_settings (team_id, org_id, enabled, window_weeks, updated_by)
  VALUES (_team_snacks, _org, true, 8, _susan), (_team_setup, _org, true, 8, _susan), (_team_kids, _org, true, 8, _susan)
  ON CONFLICT (team_id) DO NOTHING;

  SELECT array_agg(id ORDER BY id) INTO _fam FROM public.family_units WHERE org_id = _org;
  _sunday := date_trunc('week', now() AT TIME ZONE _tz)::date + 6;
  IF _sunday < (now() AT TIME ZONE _tz)::date THEN _sunday := _sunday + 7; END IF;
  FOR _i IN 0..7 LOOP
    IF _i NOT IN (5, 7) THEN
      INSERT INTO public.serving_signups (id, org_id, team_id, service_date, family_id, created_by)
      VALUES (('de3c0000-0000-0000-0000-0000000' || lpad((1000 + _i)::text, 5, '0'))::uuid, _org, _team_snacks, _sunday + 7 * _i, _fam[1 + (_i % array_length(_fam, 1))], _susan)
      ON CONFLICT (id) DO NOTHING;
    END IF;
    IF _i NOT IN (3, 6) THEN
      INSERT INTO public.serving_signups (id, org_id, team_id, service_date, family_id, created_by)
      VALUES (('de3c0000-0000-0000-0000-0000000' || lpad((2000 + _i)::text, 5, '0'))::uuid, _org, _team_setup, _sunday + 7 * _i, _fam[1 + ((_i + 3) % array_length(_fam, 1))], _susan)
      ON CONFLICT (id) DO NOTHING;
    END IF;
    IF _i <> 7 THEN
      INSERT INTO public.serving_signups (id, org_id, team_id, service_date, family_id, created_by)
      VALUES (('de3c0000-0000-0000-0000-0000000' || lpad((3000 + _i)::text, 5, '0'))::uuid, _org, _team_kids, _sunday + 7 * _i, _fam[1 + ((_i + 5) % array_length(_fam, 1))], _susan)
      ON CONFLICT (id) DO NOTHING;
    END IF;
  END LOOP;
  INSERT INTO public.team_members (org_id, team_id, profile_id, assigned_by, is_leader)
  SELECT _org, t.id, p.id, _susan, p.email = 'susan.anderson@example.test'
  FROM public.teams t
  JOIN public.profiles p ON p.org_id = _org AND p.email IN ('susan.anderson@example.test','karen.thompson@example.test','lisa.martin@example.test','rachel.king@example.test','jennifer.walker@example.test')
  WHERE t.org_id = _org
  ON CONFLICT DO NOTHING;

  -- Announcements
  INSERT INTO public.announcements (id, org_id, group_id, author_id, title, content, is_published, published_at) VALUES
    ('de3c0000-0000-0000-0000-00000000a101', _org, _yf, _susan, 'This week: chapter 4',
     'We''re in chapter 4 on Tuesday. If you missed last week, the recap is in the lecture library. Dinner is tacos — the Martins are bringing dessert.', true, now() - interval '2 days'),
    ('de3c0000-0000-0000-0000-00000000a102', _org, _yf, _susan, 'Potluck sign-up is open',
     'RSVP on the calendar so we know how many tables to set. Main dishes are the biggest need this time.', true, now() - interval '5 days'),
    ('de3c0000-0000-0000-0000-00000000a103', _org, _yf, _susan, 'Childcare schedule for November',
     'Thank you to everyone who signed up. The November rotation is on the Serving page — swap with anyone you like, just update it there.', true, now() - interval '9 days')
  ON CONFLICT (id) DO NOTHING;

  -- Prayer
  INSERT INTO public.prayer_requests (id, org_id, group_id, author_id, body, category, is_anonymous, created_at)
  SELECT r.id, _org, _yf, p.id, r.body, r.category, r.is_anonymous, r.created_at
  FROM (VALUES
    ('de3c0000-0000-0000-0000-00000000b101'::uuid, 'susan.anderson@example.test',
     'My dad''s surgery is Thursday morning. Pray for the surgeon''s hands and for Mom''s peace while she waits.', 'health', false, now() - interval '1 day'),
    ('de3c0000-0000-0000-0000-00000000b102'::uuid, 'brian.hall@example.test',
     'Job interview Friday. Praying for clarity about whether it''s the right move for us.', 'guidance', true, now() - interval '3 days'),
    ('de3c0000-0000-0000-0000-00000000b103'::uuid, 'lisa.martin@example.test',
     'Thankful — Noah slept through the night for the first time, and so did we.', 'thanksgiving', false, now() - interval '4 days')
  ) AS r (id, author_email, body, category, is_anonymous, created_at)
  JOIN public.profiles p ON p.org_id = _org AND p.email = r.author_email
  ON CONFLICT (id) DO NOTHING;
  -- "praying" counts
  INSERT INTO public.prayer_responses (org_id, group_id, request_id, profile_id)
  SELECT _org, _yf, r.id, gm.profile_id
  FROM public.prayer_requests r
  JOIN public.group_members gm ON gm.group_id = _yf AND gm.org_id = _org AND gm.profile_id <> r.author_id
  WHERE r.org_id = _org
    AND (r.id = 'de3c0000-0000-0000-0000-00000000b101'
      OR (r.id = 'de3c0000-0000-0000-0000-00000000b102' AND gm.profile_id::text < 'de3c0000-0000-0000-0000-00000000a018')
      OR (r.id = 'de3c0000-0000-0000-0000-00000000b103'))
  ON CONFLICT DO NOTHING;
END $$;
