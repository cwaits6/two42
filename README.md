# two42

[![Next.js](https://img.shields.io/badge/Next.js-16.1-black?style=flat-square&logo=nextdotjs)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind%20CSS-4-06B6D4?style=flat-square&logo=tailwindcss)](https://tailwindcss.com/)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-3ECF8E?style=flat-square&logo=supabase)](https://supabase.com/)
[![License](https://img.shields.io/badge/License-AGPL--3.0-blue?style=flat-square)](./LICENSE)
[![Deploy with Vercel](https://img.shields.io/badge/Deploy%20with-Vercel-black?style=flat-square&logo=vercel)](https://vercel.com/new/clone?repository-url=https://github.com/codyhinz/incouragers)
[![Open Source](https://img.shields.io/badge/Open-Source-orange?style=flat-square&logo=opensourceinitiative)](https://github.com/codyhinz/incouragers)

**A purpose-built web app for church connection groups — replacing Facebook groups with a warm, simple community platform.**

> **two42** — read "two forty-two," for **Acts 2:42**: the early church devoted to teaching, fellowship, breaking bread, and prayer.

two42 was originally built for the **Incouragers** Sunday small group class at **First Redeemer Church** — a group of ~150 members who needed a better home than Facebook. Designed for all ages and comfortable on any device, it gives your group a dedicated space for events, announcements, lectures, and community — without the noise of social media.

It's open source and fully configurable, so any small group or church class can fork it, set their name and colors in the database, and have it running in under an hour.

---

## Origin Story

The Incouragers class at First Redeemer Church needed a simple, welcoming space to replace their Facebook group. Members ranged widely in age and tech comfort — so everything had to be large, readable, and dead-simple to use. No cluttered feeds. No distracting algorithms. Just the group, their events, and their faith.

two42 was built to solve exactly that. It has since been open-sourced so other groups can benefit from the same foundation.

---

## Why two42?

- **Simplicity** — Easy to navigate for all ages, no distracting social media noise
- **Warmth** — Large fonts, readable text, and an inviting design that welcomes everyone
- **Affordability** — Runs for ~$10–15/year (domain name only — everything else is free)
- **Privacy** — Your community's data stays yours, not a tech company's
- **Customizable** — Fork it and brand it as your own; name, colors, and email identity are per-org rows, not a redeploy

---

## Features

### For Members

- **Public Home Page** — Welcoming hero, upcoming events, latest announcement, and a donation button
- **Events Calendar** — Browse upcoming gatherings and RSVP (Going / Maybe / Can't Go)
- **Lecture Library** — Watch past teachings with embedded YouTube videos
- **Magic Link Sign-In** — No passwords to remember; sign in with just your email
- **Member Dashboard** — See what's coming up and manage your RSVPs in one place
- **Announcements Feed** — Members-only updates and community news

### For Admins

- **Join Request Workflow** — Review and approve new members before they get access
- **Member Management** — Assign roles (member / admin) and manage the roster
- **Event Administration** — Create, edit, and manage events with public or members-only visibility
- **Announcement Posting** — Share updates with the whole community instantly
- **Lecture Management** — Add YouTube video links to build a searchable lesson library
- **Site Settings** — Update donation URL, directory link, and other settings — no code changes needed
- **Email Notifications** — Automatic welcome emails on approval and event reminders via scheduled edge functions

### Accessibility First

- Large, readable fonts (18px base) designed for all ages
- Mobile-first layout — works great on phones, tablets, and desktops
- High contrast, clear hierarchy, and minimal navigation (3–4 items max)
- Warm, welcoming color palette — not cold or corporate

---

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router) + TypeScript |
| Styling | Tailwind CSS v4 + shadcn/ui v4 |
| Auth + Database | Supabase (PostgreSQL, RLS, Edge Functions) |
| Hosting | Vercel (free tier) |
| Email | Resend (free tier: 3,000 emails/month) |
| Scheduling | Supabase pg_cron — schedule defined in `supabase/migrations/` (event + serving reminders) |

---

## Getting Started

### Prerequisites

- Node.js 18+
- A [Supabase](https://supabase.com) account (free)
- A [Resend](https://resend.com) account (free)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/codyhinz/incouragers.git
   cd incouragers
   npm install
   ```

2. **Set up Supabase**
   - Create a new project at [supabase.com/dashboard](https://supabase.com/dashboard)
   - Open the **SQL Editor** and run the migrations in order:
     1. `supabase/migrations/001_schema.sql`
     2. `supabase/migrations/002_rls.sql`
   - Find your keys at **Settings → API**

3. **Configure authentication redirect URLs**
   - In Supabase: **Authentication → URL Configuration**
   - Set **Site URL** to `http://localhost:3000`
   - Add to **Redirect URLs**:
     - `http://localhost:3000/api/auth/callback`
     - `https://yourdomain.com/api/auth/callback` (add when deploying)

4. **Set up Google Maps API** (for event location autocomplete)
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create a new project or select an existing one
   - Enable the **Places API**
   - Create an API key at **Credentials → Create Credentials → API Key**
   - (Optional) Restrict it to your domain(s) under **Application restrictions**

5. **Set up environment variables**
   ```bash
   cp .env.example .env.local
   ```
   Fill in `.env.local`:
   ```env
   NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   SUPABASE_SECRET_KEY=sb_secret_...
   RESEND_API_KEY=re_...
   NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=your-api-key-from-google-cloud
   NEXT_PUBLIC_SITE_URL=http://localhost:3000
   ```

   `NEXT_PUBLIC_ORG_SLUG` is optional and defaults to `default`, which matches the
   organization the migrations seed. It is sent as the `x-two42-org` header so
   anonymous visitors resolve the right tenant — if you set it, it must be the slug
   of a real row in `organizations`. Anonymous flows (the `/join` form, public
   content) resolve their org from this slug via `app_request_org_id()`, so a slug
   that matches no organization makes those flows fail closed rather than fall back
   to another tenant.

   `NEXT_PUBLIC_PLATFORM_APEX` is optional and defaults to `two42.io` — the
   platform apex host that `<org-slug>.<apex>` subdomains are resolved
   against. See
   [`docs/security/tenancy-model.md`](docs/security/tenancy-model.md).

6. **Start the dev server**
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000).

### Bootstrap Your First Admin

Signups are fail-closed: a new user is only created if their email already has an
approved access request or an open family invite. So approve yourself first, then
invite yourself, then promote yourself.

1. In **Supabase → SQL Editor**, approve your own email:

   ```sql
   insert into public.access_requests (org_id, name, email, status, reviewed_at)
   values (
     (select id from public.organizations where slug = 'default'),
     'Your Name', 'you@example.com', 'approved', now()
   );
   ```

2. Go to **Supabase → Authentication → Users → Invite user** and invite that same email
3. Click the magic link in the email to sign in
4. In **Table Editor → profiles**, find your row and change `role` to `admin`
5. Refresh — you'll now have access to the Admin Panel at `/admin`

> Skipping step 1 makes the invite fail with `TN001 — signup rejected: no approved
> access request or invite`.

---

## Customizing for Your Group

Branding lives in the database, in the `organizations.branding` jsonb column
(`display_name`, `logo_url`, `accent`, `reply_to`). The app shell theme, the tab
title, and outbound email all read it per-org at runtime — onboarding a second
organization is a database insert, not a redeploy.

Only two environment variables are demoted by this: `NEXT_PUBLIC_APP_NAME` and
`NEXT_PUBLIC_COLOR_PRIMARY` (see `.env.example`) survive as last-resort fallback
defaults, used when an org's branding row is empty or unreadable.
`NEXT_PUBLIC_EMAIL_FROM` is the platform-wide fallback sending address — an org
with custom sending domains enabled by a platform operator (`/platform` →
organization detail) and a **verified** claimed sending domain
(`org_email_domains`, claimed by the org's own admin under
`/admin/settings/email`) sends from `noreply@<their-domain>` instead; every
other org keeps `NEXT_PUBLIC_EMAIL_FROM`, since SPF/DKIM are only configured
for that domain by default, and Resend's account-level domain limit
(`ORG_EMAIL_DOMAIN_CAP` in `.env.example`) means it's opt-in per org rather
than open to everyone. Branding otherwise varies only the display name and
Reply-To. The remaining `NEXT_PUBLIC_COLOR_*` vars, `APP_DESCRIPTION`,
`APP_TAGLINE`, and `LOGO_MONOGRAM` are likewise still platform-wide. Everything
else — events, announcements, donation links — is managed through the admin
panel at runtime.

---

## Deploying to Production

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/codyhinz/incouragers)

1. Push your code to GitHub
2. Connect the repo at [vercel.com/new](https://vercel.com/new)
3. Add all 5 environment variables (same as `.env.local`, with your production domain for `NEXT_PUBLIC_SITE_URL`)
4. Only set `NEXT_PUBLIC_ORG_SLUG` if you renamed the seeded organization or run a
   different one — it must be the slug of a real `organizations` row, or the
   anonymous `/join` page reports that join requests are unavailable
5. Click **Deploy**

Then update your Supabase redirect URLs to include your production domain.

### Cost Breakdown

| Service | Cost |
|---|---|
| Domain name | ~$10–15/yr |
| Vercel Hobby | Free |
| Supabase Free | Free |
| Resend Free | Free |
| **Total** | **~$1/month** |

---

## Project Structure

```
├── app/
│   ├── page.tsx                  # Public home page
│   ├── events/                   # Events calendar
│   ├── lectures/                 # Lecture library
│   ├── join/                     # Join request form
│   ├── login/                    # Magic link sign-in
│   ├── dashboard/                # Member dashboard
│   ├── announcements/            # Announcements feed
│   └── admin/                    # Admin panel
├── components/
│   ├── layout/                   # Header, Footer
│   ├── events/                   # EventCard, RsvpButton
│   └── announcements/            # AnnouncementCard
├── lib/
│   ├── branding.ts               # ← Reads organizations.branding (the real source of truth)
│   ├── config.ts                 # Last-resort env fallbacks only
│   ├── email/identity.ts         # Per-org From: display name and Reply-To
│   ├── types.ts
│   └── supabase/                 # Auth clients
├── supabase/
│   ├── migrations/               # Run these in Supabase SQL Editor
│   └── functions/                # Edge Function for email reminders
└── .env.example
```

---

## Contributing

Found a bug or have a feature idea? Contributions are welcome!

1. Fork the repo
2. Create a branch: `git checkout -b feature/your-feature`
3. Commit your changes and open a Pull Request

For significant changes, please open an issue first to discuss.

---

## License

Copyright (C) 2026 Cody Waits.

Licensed under the **GNU Affero General Public License v3.0** (AGPL-3.0). You are free to
use, study, modify, and self-host this software. If users remotely interact with a modified
version over a network, AGPL section 13 requires that those users be prominently offered a
free opportunity to receive the Corresponding Source of that version. See [LICENSE](./LICENSE)
for the full terms.

---

*Originally built with love for the Incouragers class at First Redeemer Church. May it serve many communities well.*
