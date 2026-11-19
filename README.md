# two42

[![Test](https://github.com/cwaits6/two42/actions/workflows/test.yml/badge.svg)](https://github.com/cwaits6/two42/actions/workflows/test.yml)
[![Release](https://img.shields.io/github/v/release/cwaits6/two42?style=flat-square)](https://github.com/cwaits6/two42/releases)
[![License](https://img.shields.io/badge/License-AGPL--3.0-blue?style=flat-square)](./LICENSE)

Software for the people in a church's groups: who's in them, what's coming up,
who's serving, and what to pray for. A church runs one two42 space and puts its
groups in it; each member signs in once and sees the groups they belong to.

The hosted service is at [two42.io](https://two42.io). This repository is its
source, under AGPL-3.0, so a church can run its own copy. This page is for the
person who will.

## What a group gets

- **Calendar.** Events, including repeating ones, with RSVPs, address
  suggestions and a map for the location, a link to join online, reminder
  emails, and a feed that subscribes into Apple or Google Calendar.
- **Serving.** Teams and their coming dates. Members take the dates they can,
  leaders see what is still uncovered, and reminder emails go out before each
  one.
- **Directory.** Members and households, birthdays and anniversaries, showing
  what each person chooses to add to their profile.
- **Announcements**, **prayer requests** shared by name or anonymously,
  **lessons** grouped into series, and **funds** for giving to a person or
  cause in the group.
- **Joining.** A leader shares an invite link and the person sets up their own
  account from it. Church admins approve people, and manage the church's
  members, households and groups.

## How it is built

Next.js 16 (App Router) with TypeScript and Tailwind CSS 4, on Supabase:
Postgres with row-level security, Auth, Storage, and three Edge Functions that
`pg_cron` runs on a schedule. Email goes out through Resend. The hosted service
runs on Vercel; any host that runs a Next.js server will do.

## Run it locally

You need [Node.js](https://nodejs.org/) 26, npm, git, and
[Docker](https://docs.docker.com/get-started/get-docker/), which the Supabase
CLI uses to run the database locally. The CLI itself is a dev dependency, so
`npx supabase` runs the pinned version and there is nothing else to install.

```bash
git clone https://github.com/cwaits6/two42.git
cd two42
npm install
npx supabase start
```

The first start pulls the container images, then applies every migration and
`supabase/seed.sql` and prints the stack's URLs and keys. Copy the example
file, set six values and clear two:

```bash
cp .env.example .env.local
```

| Set | To |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | the printed Project URL, `http://127.0.0.1:54321` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | the printed Publishable key |
| `SUPABASE_SECRET_KEY` | the printed Secret key |
| `SERVING_LINK_SECRET` | any random string, for example `openssl rand -hex 32` |
| `PRAYER_BODY_KEY` | `openssl rand -base64 32` |
| `PRAYER_AUTHOR_KEY` | another `openssl rand -base64 32` |

| Clear | Why |
|---|---|
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | the example sets a placeholder, and any non-empty value loads Google Maps with it, so event maps show an error instead of staying out |
| `RESEND_API_KEY` | the example sets a placeholder; the app does not need Resend locally |

Leave the rest as it is. The app runs without Resend or Google Maps: without a
Resend key, invite emails fail with "We couldn't send the email", and with the
Maps key empty the event location is a plain text field and event maps are left
out.

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and sign in as
`admin@local.dev` with the password `password123`. That is the seed's church
admin, who leads one of the three sample groups; `platform@local.dev` (same
password) is the seed's operator account, and the other sample members are
listed at the top of `supabase/seed.sql`. Everything the local stack mails,
such as a password reset, lands in Mailpit at
[http://127.0.0.1:54324](http://127.0.0.1:54324); nothing leaves the machine.

`npx supabase status` prints the URLs and keys again. `npx supabase stop`
stops the stack and keeps its data. The checks CI runs, and how to run each
one locally, are in [`CLAUDE.md`](./CLAUDE.md).

## Sign-in

Members sign in with an email address and a password. There are no magic
links and no third-party sign-in.

Accounts come from invites, never from an open sign-up form:

- A leader creates an invite link under the group's settings. Someone who
  opens it enters their name and email, gets an email with a link to
  `/setup-account` that is good for seven days, and chooses a password there.
  The account is created and placed in that group straight away.
- A household invite (`/join/family/<token>`) sends a request to the church's
  admins instead. When they approve it, the person gets the same setup email.
  Someone who already has an account signs in from the same link and joins
  the household straight away, if the invite was sent to their address in
  their church.
- The database refuses anything else. A trigger on new Auth users rejects an
  email that has no approved access request and no open household invite, so
  calling Supabase Auth directly cannot create an account.
- "Forgot your password?" sends Supabase Auth's recovery email, whose link
  comes back through `/api/auth/callback` to `/update-password`. A signed-in
  member changes their password under Settings.

Two senders are involved. Invite and setup emails come from the app through
Resend; password-reset emails come from Supabase Auth through whatever SMTP
the project is configured with.

## Environment variables and secrets

Configuration lives in three places. Never commit a value; `.env.local` is
ignored by git, and `.env.example` holds placeholders only.

### The app

Set in `.env.local` locally and in the host's environment in production.
Every variable the app, `proxy.ts` and the scripts read is listed here; the
operator scripts under `scripts/` take their own on the command line and are
described in [`scripts/README.md`](./scripts/README.md).

| Variable | Required | What it is |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | The Supabase project's API URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | yes | The publishable (anon) key |
| `SUPABASE_SECRET_KEY` | yes | The secret (service role) key. Server only; it bypasses row-level security |
| `NEXT_PUBLIC_SITE_URL` | yes | The one origin the app serves. Requests for any other host get a 404, except `localhost`, `127.0.0.1` and `*.vercel.app`; emailed links are built on it too ([`docs/security/domains.md`](./docs/security/domains.md)) |
| `SERVING_LINK_SECRET` | yes | HMAC key for the serving links that act straight from an email. Use the same value in the edge function secrets |
| `PRAYER_BODY_KEY` | yes | Seals and opens prayer request text: 32 random bytes in base64. Without it the prayer page, Home's prayer section, account download and account deletion fail ([`docs/security/prayer-encryption.md`](./docs/security/prayer-encryption.md)) |
| `PRAYER_AUTHOR_KEY` | yes | Keys the hash that stands in for an anonymous prayer request's author, 32 random bytes in base64. Same failure without it |
| `PRAYER_BODY_KEY_PREVIOUS`, `PRAYER_AUTHOR_KEY_PREVIOUS` | no | Set only while rotating a prayer key |
| `RESEND_API_KEY` | in production | Sends invite, setup, approval and serving emails. The app starts without it; every send fails |
| `NEXT_PUBLIC_EMAIL_FROM` | in production | The `From:` address, `Name <address>`. Defaults to two42.io's, which Resend will refuse for any other account; use an address on a domain you have verified in Resend |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | no | Address suggestions and event maps ([setup](#event-locations)). Empty or unset leaves them out; any other value loads Google Maps with it |
| `SERVING_LINK_MODE` | no | `signed` (default) lets serving email links act without signing in; `login` sends people through sign-in. A group's own setting overrides it |
| `NEXT_PUBLIC_TIME_ZONE` | no | Zone used when a church's own time zone cannot be read. Default `America/New_York` |
| `NEXT_PUBLIC_APP_NAME`, `NEXT_PUBLIC_APP_DESCRIPTION`, `NEXT_PUBLIC_COLOR_PRIMARY`, `NEXT_PUBLIC_COLOR_PRIMARY_LIGHT`, `NEXT_PUBLIC_COLOR_ACCENT`, `NEXT_PUBLIC_COLOR_WARM`, `NEXT_PUBLIC_COLOR_BG_LIGHT`, `NEXT_PUBLIC_COLOR_BG_MUTED` | no | Fallbacks used when a church's branding row is empty. A church's name, logo and accent color are set per church by an operator |
| `ORG_EMAIL_DOMAIN_CAP` | no | Platform-wide cap on claimed custom sending domains. Default 8 |
| `THIRD_PARTY_PAGE_VIEWS` | no | `on` also loads the hosting provider's page-view script, which is sent route patterns only. Unset keeps only the app's own usage counts |
| `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_SERVICE_NAME` | no | OpenTelemetry tracing to any OTLP/HTTP receiver. Unset turns tracing off. Spans hold timings, route patterns and status codes, never a real page address, query value or error text; a span for an outgoing request keeps the server it called: see [`docs/security/logging.md`](docs/security/logging.md) |

### Edge function secrets

Set once per Supabase project with `npx supabase secrets set NAME=value`, or
under Edge Functions → Secrets in the dashboard. The three functions read
these:

| Secret | Required | What it is |
|---|---|---|
| `RESEND_API_KEY` | yes | Sends the reminder emails |
| `SITE_URL` | yes | The origin for every link in a reminder. Defaults to `https://two42.io` |
| `SERVING_LINK_SECRET` | yes | The same value as the app's. Without it, serving emails carry links that require sign-in instead |
| `EMAIL_FROM` | in production | The `From:` address, same rule as the app's |
| `SERVING_LINK_MODE` | no | Same meaning as the app's |
| `APP_NAME`, `BRAND_COLOR` | no | Fallbacks for the email branding when a church's row is empty |

`SUPABASE_URL` and the service key (`SUPABASE_SECRET_KEYS` on hosted
projects, `SUPABASE_SERVICE_ROLE_KEY` on the local stack) are injected by
Supabase; do not set them.

### Vault secrets

The scheduled jobs are `pg_cron` entries that call the edge functions over
`pg_net`. They read the project URL and a service key from Supabase Vault by
name, because neither can be committed. **Both are required.** Until they
exist, every job still runs on schedule and fails, and nothing in the app
shows it. Create them once, in the SQL editor:

```sql
select vault.create_secret('https://<project-ref>.supabase.co', 'cron_project_url');
select vault.create_secret('<the secret key>', 'cron_service_role_key');
```

To check them, and to check that the jobs are running:

```sql
select name from vault.decrypted_secrets
 where name in ('cron_project_url', 'cron_service_role_key');   -- expect both rows

select jobname, status, return_message, start_time
  from cron.job_run_details order by start_time desc limit 10;   -- did each job run?

select status_code, created
  from net._http_response order by created desc limit 10;       -- expect 200s
```

A `401` means the vault key is not one of the function's service keys. The
same check, as one query, is `scripts/check-scheduled-jobs.sql`; this
repository's CI runs it against the hosted project every six hours.

| Job | When (UTC) | Function |
|---|---|---|
| `send-event-reminders-daily` | 15:00, 16:00 and 17:00 daily | `send-event-reminders` |
| `send-serving-reminders-hourly` | Every hour, on the hour | `send-serving-reminders` |
| `send-serving-monthly-broadcast` | 15:00 on the 1st | `send-serving-reminders` |
| `clean-up-expired-data-nightly` | 09:00 daily | `clean-up-expired-data` |

## Deploying to Production

You need a [Supabase](https://supabase.com/dashboard) project, a
[Resend](https://resend.com) account with a verified sending domain, a host
for the Next.js app, and a domain.

**Database and functions.** From a checkout, link the project, apply the
migrations, deploy the functions and set their secrets:

```bash
npx supabase login
npx supabase link --project-ref <project-ref>
npx supabase db push --remote
npx supabase functions deploy send-event-reminders send-serving-reminders clean-up-expired-data
npx supabase secrets set RESEND_API_KEY=<key> SITE_URL=https://your.domain \
  SERVING_LINK_SECRET=<secret> EMAIL_FROM='Your Church <noreply@your.domain>'
```

Then create the two Vault secrets above. Repeat `db push --remote` and
`functions deploy` after every update. Each asks before it changes the
project, unless `--yes` is passed or `SUPABASE_YES` is exported in the shell. This repository's own CI does both on
each push to `main` that touches `supabase/` or the database types
([`.github/workflows/supabase.yml`](./.github/workflows/supabase.yml))
with the repository secrets `SUPABASE_PROJECT_REF`, `SUPABASE_ACCESS_TOKEN` and
`SUPABASE_DB_PASSWORD`, plus a GitHub App (`APP_CLIENT_ID`, `APP_PRIVATE_KEY`)
that commits the schema dump; a fork can set the same secrets.

**Auth settings.** Under Authentication in the dashboard: set the Site URL to
your origin, add `https://your.domain/api/auth/callback` to the redirect
URLs, and configure a [custom SMTP sender](https://supabase.com/docs/guides/auth/auth-smtp)
for password-reset emails; Supabase's built-in sender is rate-limited and
meant for testing. Accounts are created on the server, already confirmed,
from the setup link, so setup signs the person in whatever "Confirm email" is
set to; turning it off is still recommended, so no other path sends a second
confirmation message.

**The app.** Import the repository at [vercel.com/new](https://vercel.com/new),
or any Next.js host, set the app variables from the table above with
`NEXT_PUBLIC_SITE_URL` as your production origin, deploy, and attach your
domain. Keep two copies of the prayer keys outside the host: request text
sealed with a lost body key cannot be recovered.

**Upgrading an install that already has prayer requests.** Requests posted
before the release that seals prayer text stay in plaintext until you convert
them. Set the two prayer keys, deploy, apply the migrations, then run
`scripts/encrypt-prayer-requests.mjs` as described in
[`docs/security/prayer-encryption.md`](./docs/security/prayer-encryption.md)
("Converting existing rows"). Once that release's migration is applied, do not
roll the app back to a build from before it; see "Rolling back" there.

**The first church admin.** The migrations create one church with one group.
Approve your own email in the SQL editor, as a church admin:

```sql
insert into public.access_requests (org_id, name, email, status, reviewed_at, approved_role)
values ((select id from public.organizations), 'Your Name', 'you@example.com', 'approved', now(), 'admin');
```

Then, under Authentication → Users, add a user with that email and a password,
with auto-confirm on. The sign-up trigger creates your profile as a church
admin, and you can sign in at `/login`. Without the approved request first,
the user creation fails with `signup rejected: no approved access request or
invite`. To rename the church, set its logo and accent color, or add more
churches, make your account an operator and open `/platform`:

```sql
insert into public.platform_admins (profile_id) values ('<your auth user id>');
```

**Make it yours.** Before offering your install to others, replace the two42
name and the files in `public/brand/` ([`TRADEMARK.md`](./TRADEMARK.md)), the
security contact in [`SECURITY.md`](./SECURITY.md) and
`public/.well-known/security.txt`, the GitHub and contact links in
`components/landing/sections.ts`, and the `/privacy` and `/terms` pages, which
are placeholders.

## Event locations

Optional. Without a key, people type a location as plain text, and the calendar's
list view still links it to Google Maps. With one, the location field suggests
addresses, and the event page draws a map when Google can find the location.

1. In the [Google Cloud Console](https://console.cloud.google.com/), create or
   choose a project and attach a billing account, which Google Maps Platform
   requires.
2. Enable the **Maps JavaScript API**, **Places API (New)** and **Geocoding
   API**. Suggestions use Places, and the event map uses the other two.
3. Create an API key under **Credentials**, and set it as
   `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`.
4. Restrict the key, because it is sent to every browser that loads the app.
   Limit it to those three APIs, and under **Application restrictions** to your
   domain, plus `http://localhost:*/*` if you use the same key locally.

A person can always keep what they typed instead of picking a suggestion.

## Where things live

- `app/` — the routes. `app/g/[groupId]/` is a group's screens, `app/admin/` the church admin's, `app/platform/` the operator's
- `app/(auth)/` and `app/api/auth/` — sign-in, account setup and password reset
- `components/` — UI. `components/ui/` is the shadcn and Base UI set, `components/landing/` the public page
- `lib/` — shared logic. `lib/supabase/` holds the clients and generated types, `lib/email/` the Resend senders
- `supabase/migrations/` — schema, policies, functions and the cron schedules. `supabase/schema.sql` is the dump CI commits after each push
- `supabase/functions/` — the three scheduled edge functions; `_shared/` is the unit-tested part
- `supabase/tests/` — pgTAP suites for tenancy and policies
- `supabase/seed.sql` — local sample data and logins
- `e2e/` — Playwright specs for what a signed-in member can see
- `scripts/` — the tenancy guard, the scheduled-jobs check and the storage re-key, described in `scripts/README.md`
- `docs/security/` — the tenancy model, the service-role inventory, hosts, roles, and what is logged
- `docs/design/DESIGN.md` — the design system; `CONTEXT.md` — the product's vocabulary
- `CLAUDE.md` and `AGENTS.md` — the working rules for contributors and coding agents

## Contributing

Open an issue first for anything beyond a small fix. How to write issues and
pull requests, and which labels and templates to use, is in
[`docs/contributing/issues-and-prs.md`](./docs/contributing/issues-and-prs.md);
the rest is in [`CONTRIBUTING.md`](./CONTRIBUTING.md). Security problems go
to the address in [`SECURITY.md`](./SECURITY.md), not to a public issue.

## License

Copyright (C) 2026 Cody Waits.

Licensed under the GNU Affero General Public License v3.0 ([`LICENSE`](./LICENSE)).
You may use, study, modify and self-host it. If people use a modified version
over a network, section 13 requires that they be offered the source of that
version. The two42 name and brand files are not covered by the license; see
[`TRADEMARK.md`](./TRADEMARK.md).
