-- Sample church for product screenshots: Hillside Church. The church, its
-- groups and every person in it are invented. The names were picked to be
-- ordinary, not after anyone: any match with a real church, group or person
-- is a coincidence. Every email is on the reserved example.test domain. The
-- church is created beside the test seed's "Sample Organization" and touches
-- none of its rows; re-running the script is a no-op for rows that exist.
--
-- Three groups, each with its own calendar:
--   Cornerstone           the group every screenshot shows: weekly Tuesday
--                         dinner and study with a link to join online,
--                         coming events with replies, three serving teams,
--                         announcements, prayer, a lesson series on Acts and two funds
--   Young Adults          a monthly dinner
--   Tuesday Night Group   a weekly study
--
-- Sign-ins (password123 for both):
--   sarah.bennett@example.test   church admin; leads Cornerstone and its
--                                serving teams
--   david.carter@example.test    member of Cornerstone and Tuesday Night
--                                Group; the screenshots are taken as him
-- Every other adult with an account signs in as <first>.<surname>@example.test
-- with the same password.
--
-- Apply through the shared local container (never a remote project):
--   docker exec -i supabase_db_small-group-hub \
--     psql -U postgres -d postgres -f - < supabase/demo/hillside-church.sql

DO $$
DECLARE
  _org uuid;
  _household RECORD;
  _person RECORD;
  _family_id uuid;
  _user_id uuid;
  _email text;
  _group_name text;
  _lead uuid;
  _main uuid; _ya uuid; _tn uuid;
  _main_cal uuid; _ya_cal uuid; _tn_cal uuid;
  _tz CONSTANT text := 'America/New_York';
  _sunday date;
  _i int;
  _team_snacks uuid := '5a3e0000-0000-0000-0000-00000000b001';
  _team_setup  uuid := '5a3e0000-0000-0000-0000-00000000b002';
  _team_greet   uuid := '5a3e0000-0000-0000-0000-00000000b003';
  _fam uuid[];
BEGIN
  -- Only the CLI's local stack runs on its published default JWT secret; a
  -- hosted project always has its own. The check lives inside the one block
  -- that writes, so psql without ON_ERROR_STOP cannot run past it.
  IF current_setting('app.settings.jwt_secret', true)
     IS DISTINCT FROM 'super-secret-jwt-token-with-at-least-32-characters-long' THEN
    RAISE EXCEPTION 'hillside-church.sql holds well-known development logins and only runs on the local Supabase stack';
  END IF;

  -- This file's own group id is the rerun marker: a same-named organization
  -- that this script did not create is never adopted.
  SELECT org_id INTO _org FROM public.groups WHERE id = '5a3e0000-0000-0000-0000-00000000c001';
  IF _org IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.organizations WHERE id = _org AND name = 'Hillside Church'
  ) THEN
    RAISE EXCEPTION 'hillside-church.sql: the sample group id belongs to another organization; refusing to write into it';
  END IF;
  IF _org IS NULL THEN
    _org := public.provision_organization('Hillside Church', 'sarah.bennett@example.test');
  END IF;

  -- Groups
  INSERT INTO public.groups (id, org_id, name, description) VALUES
    ('5a3e0000-0000-0000-0000-00000000c001', _org, 'Cornerstone', 'Tuesday evenings at the Bennetts''. Dinner, then a study.'),
    ('5a3e0000-0000-0000-0000-00000000c002', _org, 'Young Adults', 'Second Sunday of the month over dinner.'),
    ('5a3e0000-0000-0000-0000-00000000c003', _org, 'Tuesday Night Group', 'Tuesday evenings at the Sullivans''.')
  ON CONFLICT (id) DO NOTHING;
  _main := '5a3e0000-0000-0000-0000-00000000c001';
  _ya := '5a3e0000-0000-0000-0000-00000000c002';
  _tn := '5a3e0000-0000-0000-0000-00000000c003';

  INSERT INTO public.event_calendars (id, org_id, group_id, name) VALUES
    ('5a3e0000-0000-0000-0000-00000000ca01', _org, _main, 'Cornerstone'),
    ('5a3e0000-0000-0000-0000-00000000ca02', _org, _ya, 'Young Adults'),
    ('5a3e0000-0000-0000-0000-00000000ca03', _org, _tn, 'Tuesday Night Group')
  ON CONFLICT (id) DO NOTHING;
  _main_cal := '5a3e0000-0000-0000-0000-00000000ca01';
  _ya_cal := '5a3e0000-0000-0000-0000-00000000ca02';
  _tn_cal := '5a3e0000-0000-0000-0000-00000000ca03';

  -- Households and people
  CREATE TEMP TABLE sample_households (
    seq serial PRIMARY KEY, surname text UNIQUE NOT NULL, address_line1 text, city text, state text,
    postal_code text, phone_home text, anniversary date, groups text[] NOT NULL, leads text
  ) ON COMMIT DROP;
  INSERT INTO sample_households (surname, address_line1, city, state, postal_code, phone_home, anniversary, groups, leads) VALUES
    ('Bennett',  '14 Maple Court',     'Springfield', 'IL', '62701', '555-0141', '2012-06-09', '{Cornerstone}',                     'Cornerstone'),
    ('Carter',   '220 Oak Street',     'Springfield', 'IL', '62701', '555-0142', '2006-09-23', '{Cornerstone,Tuesday Night Group}', NULL),
    ('Hughes',   '31 Birch Lane',      'Springfield', 'IL', '62702', '555-0143', '2016-05-14', '{Cornerstone}',                     NULL),
    ('Morales',  '47 Willow Drive',    'Springfield', 'IL', '62702', '555-0144', '2026-06-14', '{Young Adults}',                    'Young Adults'),
    ('Nguyen',   '58 Cedar Avenue',    'Springfield', 'IL', '62703', NULL,       NULL,         '{Cornerstone}',                     NULL),
    ('Okafor',   '63 Elm Place',       'Springfield', 'IL', '62703', '555-0146', '2026-03-21', '{Young Adults}',                    NULL),
    ('Parker',   '72 Pine Street',     'Springfield', 'IL', '62704', '555-0147', '2013-10-05', '{Cornerstone}',                     NULL),
    ('Sullivan', '89 Spruce Road',     'Springfield', 'IL', '62704', '555-0148', '2004-08-28', '{Tuesday Night Group}',             'Tuesday Night Group'),
    ('Reyes',    '105 Chestnut Court', 'Springfield', 'IL', '62705', '555-0149', '2011-04-16', '{Cornerstone}',                     NULL);

  CREATE TEMP TABLE sample_people (
    seq serial PRIMARY KEY, surname text NOT NULL REFERENCES sample_households (surname), first_name text NOT NULL,
    relationship text NOT NULL, has_account boolean NOT NULL, birth_month smallint, birth_day smallint, birth_year smallint
  ) ON COMMIT DROP;
  INSERT INTO sample_people (surname, first_name, relationship, has_account, birth_month, birth_day, birth_year) VALUES
    ('Bennett',  'Sarah',  'primary', true,  3,  14, 1986),
    ('Bennett',  'Tom',    'spouse',  true,  11, 2,  1984),
    ('Bennett',  'Ella',   'child',   false, 7,  19, 2016),
    ('Bennett',  'Sam',    'child',   false, 1,  8,  2019),
    ('Carter',   'David',  'primary', true,  5,  30, 1978),
    ('Carter',   'Anna',   'spouse',  true,  8,  12, 1979),
    ('Carter',   'Luke',   'child',   false, 12, 3,  2009),
    ('Hughes',   'Peter',  'primary', true,  9,  9,  1989),
    ('Hughes',   'Claire', 'spouse',  true,  2,  27, 1990),
    ('Hughes',   'Nora',   'child',   false, 6,  15, 2018),
    ('Hughes',   'Eli',    'child',   false, 4,  4,  2026),
    ('Morales',  'Daniel', 'primary', true,  10, 21, 1996),
    ('Morales',  'Elena',  'spouse',  true,  3,  3,  1997),
    ('Nguyen',   'Linh',   'primary', true,  8,  30, 1987),
    ('Nguyen',   'Mia',    'child',   false, 11, 11, 2017),
    ('Okafor',   'Ben',    'primary', true,  7,  7,  1995),
    ('Okafor',   'Ada',    'spouse',  true,  1,  23, 1996),
    ('Parker',   'Ruth',   'primary', true,  12, 1,  1985),
    ('Parker',   'James',  'spouse',  false, 4,  18, 1984),
    ('Parker',   'May',    'child',   false, 10, 5,  2015),
    ('Parker',   'Theo',   'child',   false, 6,  6,  2018),
    ('Sullivan', 'Mark',   'primary', true,  9,  28, 1975),
    ('Sullivan', 'Joan',   'spouse',  true,  2,  2,  1977),
    ('Sullivan', 'Owen',   'child',   false, 8,  8,  2010),
    ('Reyes',    'Maria',  'primary', true,  5,  5,  1988),
    ('Reyes',    'Carlos', 'spouse',  true,  3,  31, 1987),
    ('Reyes',    'Lucia',  'child',   false, 6,  21, 2014),
    ('Reyes',    'Mateo',  'child',   false, 10, 10, 2017);

  FOR _household IN SELECT * FROM sample_households ORDER BY seq LOOP
    _family_id := ('5a3e0000-0000-0000-0000-00000000f' || lpad(_household.seq::text, 3, '0'))::uuid;
    INSERT INTO public.family_units (id, org_id, family_name, address_line1, city, state, postal_code, phone_home, anniversary)
    VALUES (_family_id, _org, _household.surname, _household.address_line1, _household.city, _household.state,
            _household.postal_code, _household.phone_home, _household.anniversary)
    ON CONFLICT (id) DO NOTHING;

    FOR _person IN SELECT * FROM sample_people WHERE surname = _household.surname ORDER BY seq LOOP
      IF NOT _person.has_account THEN
        INSERT INTO public.family_members (id, org_id, family_id, first_name, last_name, relationship, is_class_member, birth_month, birth_day, birth_year)
        VALUES (('5a3e0000-0000-0000-0000-00000000d' || lpad(_person.seq::text, 3, '0'))::uuid, _org, _family_id,
                _person.first_name, _household.surname, _person.relationship, _person.relationship <> 'child',
                _person.birth_month, _person.birth_day, _person.birth_year)
        ON CONFLICT (id) DO NOTHING;
        CONTINUE;
      END IF;

      _user_id := ('5a3e0000-0000-0000-0000-00000000a' || lpad(_person.seq::text, 3, '0'))::uuid;
      _email := lower(_person.first_name || '.' || _household.surname || '@example.test');
      IF _email = 'sarah.bennett@example.test' THEN _lead := _user_id; END IF;

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
    ('5a3e0000-0000-0000-0000-00000000e001', _org, _main, _main_cal, 'Dinner and study',
     'Dinner together, then a short study. Come when you can; the study starts at 7.', 'The Bennett home',
     ((date_trunc('week', now() AT TIME ZONE _tz)::date + 1) + time '18:30') AT TIME ZONE _tz,
     ((date_trunc('week', now() AT TIME ZONE _tz)::date + 1) + time '20:00') AT TIME ZONE _tz,
     _lead, 'weekly', 1, 'never', 'https://example.zoom.us/j/00000000001', '000 0000 0001', '242424'),
    ('5a3e0000-0000-0000-0000-00000000e002', _org, _main, _main_cal, 'Serve Day at the Food Pantry',
     'Sorting and packing for the Saturday distribution. Wear closed shoes.', 'Community Food Pantry, 400 Main Street',
     ((date_trunc('week', now() AT TIME ZONE _tz)::date + 12) + time '09:00') AT TIME ZONE _tz,
     ((date_trunc('week', now() AT TIME ZONE _tz)::date + 12) + time '11:30') AT TIME ZONE _tz,
     _lead, NULL, 1, NULL, NULL, NULL, NULL),
    ('5a3e0000-0000-0000-0000-00000000e003', _org, _main, _main_cal, 'Fall Potluck',
     'Bring a dish to share. Drinks and plates are covered.', 'Fellowship Hall',
     ((date_trunc('week', now() AT TIME ZONE _tz)::date + 20) + time '17:00') AT TIME ZONE _tz,
     ((date_trunc('week', now() AT TIME ZONE _tz)::date + 20) + time '19:00') AT TIME ZONE _tz,
     _lead, NULL, 1, NULL, NULL, NULL, NULL),
    ('5a3e0000-0000-0000-0000-00000000e004', _org, _main, _main_cal, 'Christmas Caroling',
     'Meet in the church parking lot. Hot chocolate after at the Carters''.', 'Church parking lot',
     (make_date(extract(year from now())::int, 12, 13) + time '18:00') AT TIME ZONE _tz,
     (make_date(extract(year from now())::int, 12, 13) + time '20:00') AT TIME ZONE _tz,
     _lead, NULL, 1, NULL, NULL, NULL, NULL),
    ('5a3e0000-0000-0000-0000-00000000e005', _org, _ya, _ya_cal, 'Young Adults dinner',
     'Second Sunday of the month. This month at the Moraleses''.', 'The Morales home',
     ((date_trunc('week', now() AT TIME ZONE _tz)::date + 13) + time '18:00') AT TIME ZONE _tz,
     ((date_trunc('week', now() AT TIME ZONE _tz)::date + 13) + time '20:00') AT TIME ZONE _tz,
     _lead, NULL, 1, NULL, NULL, NULL, NULL),
    ('5a3e0000-0000-0000-0000-00000000e006', _org, _tn, _tn_cal, 'Tuesday study',
     'Reading through the Gospel of Mark.', 'The Sullivan home',
     ((date_trunc('week', now() AT TIME ZONE _tz)::date + 1) + time '19:00') AT TIME ZONE _tz,
     ((date_trunc('week', now() AT TIME ZONE _tz)::date + 1) + time '20:30') AT TIME ZONE _tz,
     _lead, 'weekly', 1, 'never', NULL, NULL, NULL)
  ON CONFLICT (id) DO NOTHING;

  -- RSVPs: the whole group is coming Tuesday; most of it to the potluck.
  -- A reply is for one date: the weekly meeting's is on its next Tuesday that
  -- has not ended.
  INSERT INTO public.rsvps (org_id, event_id, user_id, status, occurrence_date)
  SELECT _org, '5a3e0000-0000-0000-0000-00000000e001', gm.profile_id, 'yes',
         date_trunc('week', now() AT TIME ZONE _tz)::date + 1
           + CASE WHEN now() AT TIME ZONE _tz >= (date_trunc('week', now() AT TIME ZONE _tz)::date + 1) + time '20:00'
                  THEN 7 ELSE 0 END
  FROM public.group_members gm WHERE gm.group_id = _main AND gm.org_id = _org
    AND NOT EXISTS (SELECT 1 FROM public.rsvps r
                    WHERE r.org_id = _org AND r.event_id = '5a3e0000-0000-0000-0000-00000000e001'
                      AND r.user_id = gm.profile_id)
  ON CONFLICT (event_id, user_id, occurrence_date) DO NOTHING;
  INSERT INTO public.rsvps (org_id, event_id, user_id, status, occurrence_date)
  SELECT _org, e.id, gm.profile_id,
         CASE WHEN row_number() OVER (ORDER BY gm.profile_id) <= 7 THEN 'yes' ELSE 'maybe' END,
         (e.start_time AT TIME ZONE _tz)::date
  FROM public.group_members gm
  JOIN public.events e ON e.id = '5a3e0000-0000-0000-0000-00000000e003' AND e.org_id = _org
  WHERE gm.group_id = _main AND gm.org_id = _org
  ON CONFLICT (event_id, user_id, occurrence_date) DO NOTHING;

  -- Serving teams in Cornerstone, with most of the coming weeks covered.
  INSERT INTO public.teams (id, org_id, group_id, name, description, color, icon, display_order, is_serving_role, created_by) VALUES
    (_team_snacks, _org, _main, 'Snacks',    'Brings snacks and coffee for Tuesday night', '#B85C38', 'utensils', 0, true, _lead),
    (_team_setup,  _org, _main, 'Set-up',    'Chairs and tables before 6',                 '#7C9885', 'hands',    1, true, _lead),
    (_team_greet,   _org, _main, 'Greeting',  'Welcomes people at the door',                 '#E8A33D', 'heart',    2, true, _lead)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.serving_team_settings (team_id, org_id, enabled, window_weeks, updated_by)
  VALUES (_team_snacks, _org, true, 8, _lead), (_team_setup, _org, true, 8, _lead), (_team_greet, _org, true, 8, _lead)
  ON CONFLICT (team_id) DO NOTHING;

  SELECT array_agg(id ORDER BY id) INTO _fam FROM public.family_units WHERE org_id = _org;
  _sunday := date_trunc('week', now() AT TIME ZONE _tz)::date + 6;
  IF _sunday < (now() AT TIME ZONE _tz)::date THEN _sunday := _sunday + 7; END IF;
  FOR _i IN 0..7 LOOP
    IF _i NOT IN (5, 7) THEN
      INSERT INTO public.serving_signups (id, org_id, team_id, service_date, family_id, created_by)
      VALUES (('5a3e0000-0000-0000-0000-0000000' || lpad((1000 + _i)::text, 5, '0'))::uuid, _org, _team_snacks, _sunday + 7 * _i, _fam[1 + (_i % array_length(_fam, 1))], _lead)
      ON CONFLICT (id) DO NOTHING;
    END IF;
    IF _i NOT IN (3, 6) THEN
      INSERT INTO public.serving_signups (id, org_id, team_id, service_date, family_id, created_by)
      VALUES (('5a3e0000-0000-0000-0000-0000000' || lpad((2000 + _i)::text, 5, '0'))::uuid, _org, _team_setup, _sunday + 7 * _i, _fam[1 + ((_i + 3) % array_length(_fam, 1))], _lead)
      ON CONFLICT (id) DO NOTHING;
    END IF;
    IF _i <> 7 THEN
      INSERT INTO public.serving_signups (id, org_id, team_id, service_date, family_id, created_by)
      VALUES (('5a3e0000-0000-0000-0000-0000000' || lpad((3000 + _i)::text, 5, '0'))::uuid, _org, _team_greet, _sunday + 7 * _i, _fam[1 + ((_i + 5) % array_length(_fam, 1))], _lead)
      ON CONFLICT (id) DO NOTHING;
    END IF;
  END LOOP;
  INSERT INTO public.team_members (org_id, team_id, profile_id, assigned_by, is_leader)
  SELECT _org, m.team_id, p.id, _lead, m.is_leader
  FROM (VALUES
    (_team_snacks, 'sarah.bennett@example.test', true),
    (_team_snacks, 'claire.hughes@example.test', false),
    (_team_snacks, 'maria.reyes@example.test',   false),
    (_team_setup,  'peter.hughes@example.test',  true),
    (_team_setup,  'linh.nguyen@example.test',   false),
    (_team_setup,  'carlos.reyes@example.test',  false),
    (_team_greet,  'ruth.parker@example.test',   true),
    (_team_greet,  'david.carter@example.test',  false),
    (_team_greet,  'anna.carter@example.test',   false)
  ) AS m (team_id, email, is_leader)
  JOIN public.profiles p ON p.org_id = _org AND p.email = m.email
  ON CONFLICT DO NOTHING;

  -- Announcements
  INSERT INTO public.announcements (id, org_id, group_id, author_id, title, content, is_published, published_at) VALUES
    ('5a3e0000-0000-0000-0000-00000000a101', _org, _main, _lead, 'This week: Acts 4',
     'We''re in Acts 4 on Tuesday. If you missed last week, the recording is in Lessons. Dinner is tacos, and the Hugheses are bringing dessert.', true, now() - interval '2 days'),
    ('5a3e0000-0000-0000-0000-00000000a102', _org, _main, _lead, 'Potluck sign-up is open',
     'RSVP on the calendar so we know how many tables to set. Main dishes are the biggest need this time.', true, now() - interval '5 days'),
    ('5a3e0000-0000-0000-0000-00000000a103', _org, _main, _lead, 'Serving dates for November',
     'Thank you to everyone who signed up. The November dates are on the Serving page. Swap with anyone you like, and update it there.', true, now() - interval '9 days')
  ON CONFLICT (id) DO NOTHING;

  -- Prayer
  INSERT INTO public.prayer_requests (id, org_id, group_id, author_id, body, is_anonymous, created_at)
  SELECT r.id, _org, _main, p.id, r.body, r.is_anonymous, r.created_at
  FROM (VALUES
    ('5a3e0000-0000-0000-0000-00000000b101'::uuid, 'sarah.bennett@example.test',
     'My dad''s surgery is Thursday morning. Pray for the surgeon''s hands and for Mom''s peace while she waits.', false, now() - interval '1 day'),
    ('5a3e0000-0000-0000-0000-00000000b102'::uuid, 'ben.okafor@example.test',
     'Job interview Friday. Praying for clarity about whether it''s the right move for us.', true, now() - interval '3 days'),
    ('5a3e0000-0000-0000-0000-00000000b103'::uuid, 'claire.hughes@example.test',
     'Thankful: Eli slept through the night for the first time, and so did we.', false, now() - interval '4 days')
  ) AS r (id, author_email, body, is_anonymous, created_at)
  JOIN public.profiles p ON p.org_id = _org AND p.email = r.author_email
  ON CONFLICT (id) DO NOTHING;
  -- "praying" counts
  INSERT INTO public.prayer_responses (org_id, group_id, request_id, profile_id)
  SELECT _org, _main, r.id, gm.profile_id
  FROM public.prayer_requests r
  JOIN public.group_members gm ON gm.group_id = _main AND gm.org_id = _org AND gm.profile_id <> r.author_id
  WHERE r.org_id = _org
    AND (r.id = '5a3e0000-0000-0000-0000-00000000b101'
      OR (r.id = '5a3e0000-0000-0000-0000-00000000b102' AND gm.profile_id::text < '5a3e0000-0000-0000-0000-00000000a018')
      OR (r.id = '5a3e0000-0000-0000-0000-00000000b103'))
  ON CONFLICT DO NOTHING;

  -- Lessons. The recordings are not real videos: the ids below belong to no
  -- one, so the app shows its no-picture look for them. The landing capture
  -- scripts answer the thumbnail requests with scripts/landing/thumbnails/.
  INSERT INTO public.lecture_series (id, org_id, group_id, name, teacher)
  VALUES ('5a3e0000-0000-0000-0000-00000000c101', _org, _main, 'The Book of Acts', 'Tom Bennett')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.lectures (id, org_id, group_id, series_id, week_number, title, scripture_reference, summary, video_url, lecture_date, created_by)
  SELECT l.id, _org, _main, '5a3e0000-0000-0000-0000-00000000c101', l.week, l.title, l.scripture, l.summary,
         'https://www.youtube.com/watch?v=two42acts0' || l.week,
         date_trunc('week', now() AT TIME ZONE _tz)::date + 1 - 7 * (4 - l.week), _lead
  FROM (VALUES
    ('5a3e0000-0000-0000-0000-00000000c111'::uuid, 1, 'You will be my witnesses', 'Acts 1',
     'The promise of the Spirit, and the disciples waiting together in prayer.'),
    ('5a3e0000-0000-0000-0000-00000000c112'::uuid, 2, 'The day of Pentecost', 'Acts 2',
     'How the church began, and the four habits of the first believers.'),
    ('5a3e0000-0000-0000-0000-00000000c113'::uuid, 3, 'A man healed at the gate', 'Acts 3',
     'Peter and John at the temple, and what the healing pointed to.')
  ) AS l (id, week, title, scripture, summary)
  ON CONFLICT (id) DO NOTHING;

  -- Funds, each going to the person who receives the gifts.
  INSERT INTO public.giving_funds (id, org_id, group_id, name, description, steward_id, steward_role, display_order, created_by)
  SELECT f.id, _org, _main, f.name, f.description, p.id, f.steward_role, f.display_order, _lead
  FROM (VALUES
    ('5a3e0000-0000-0000-0000-00000000c201'::uuid, 'Meals for the Reyes family',
     'Maria is recovering from surgery. Gifts go toward dinners for the next month.', 'carlos.reyes@example.test', 'Receives the gifts', 0),
    ('5a3e0000-0000-0000-0000-00000000c202'::uuid, 'Food pantry serve day',
     'Covers the groceries we bring to the pantry.', 'peter.hughes@example.test', 'Buys the groceries', 1)
  ) AS f (id, name, description, steward_email, steward_role, display_order)
  JOIN public.profiles p ON p.org_id = _org AND p.email = f.steward_email
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.giving_fund_methods (org_id, group_id, fund_id, method, custom_handle, display_order)
  SELECT _org, _main, m.fund_id, m.method, m.handle, m.display_order
  FROM (VALUES
    ('5a3e0000-0000-0000-0000-00000000c201'::uuid, 'venmo',  '@carlos-reyes-example',      0),
    ('5a3e0000-0000-0000-0000-00000000c201'::uuid, 'zelle',  'carlos.reyes@example.test',  1),
    ('5a3e0000-0000-0000-0000-00000000c202'::uuid, 'paypal', 'peterhughesexample',         0)
  ) AS m (fund_id, method, handle, display_order)
  ON CONFLICT (fund_id, method) DO NOTHING;
END $$;
