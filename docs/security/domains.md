# Hosts — one canonical host, no per-org web domains

The app serves all traffic from a single canonical host, the
`NEXT_PUBLIC_SITE_URL` host (`two42.io` in production). Org subdomains
(`<slug>.two42.io`) and tenant custom web domains are retired. The tenancy
rules this sits inside are in [`tenancy-model.md`](tenancy-model.md).

This page is about **web hosting**. Per-org **email sending** domains
(`org_email_domains`, `organizations.custom_email_domain_enabled`, the
`SENDING_DOMAIN` gate in `lib/email/identity.ts`) are a separate mechanism
and are unaffected. Their admin surface — the Admin › Settings tile,
`/admin/settings/email` and the `/api/admin/email-domain` routes — is hidden
behind `CUSTOM_SENDING_DOMAINS_ENABLED` in `lib/email/sendingDomains.ts`,
which stays `false` until there is a paid tier: a custom domain only changes
the part of the `From:` address after the `@`, and keeping it working means a
volunteer admin adding and maintaining SPF, DKIM and DMARC records — the most
support-heavy thing we could hand them, for a benefit that matters mainly to
large orgs. If it ships, it is a paid-tier feature. On the hosted service
every email leaves from the platform address, with the org's name as the
display name and the org's `reply_to` for replies. The schema, the
`SENDING_DOMAIN` gate and its edge-function mirror, the pgTAP suite and the
platform operator's per-org toggle are untouched, so flipping the flag
re-enables the surface without a migration.

## How a request finds its org

The request host never names an org.

| Caller | Org comes from |
|--------|----------------|
| Authenticated | `profiles.org_id` via `app_current_org_id()` — independent of hostname |
| Anonymous, token link | The token's own row, read on the service client: `/setup-account` (signup token), `/join/family/[token]` (family invite), `/serving/go` (HMAC-validated serving token), `/join/[token]` (group invite) |
| Anything else anonymous | Resolves no org (fail closed): `app_request_org_id()` is NULL, so every org-owned read returns no rows and every write is refused |

## The expected-host check

`lib/supabase/middleware.ts` runs `isExpectedHost()` (`lib/org.ts`) on the
normalized `Host` before any client is built or any route runs. It accepts:

- the `NEXT_PUBLIC_SITE_URL` host — the canonical host;
- `localhost` and `127.0.0.1` — local dev;
- `*.vercel.app` — preview deployments.

Every other host gets a bare `404` and no app response. The set is closed
and static: nothing in the database can widen it. A request on an accepted
host behaves identically whichever accepted host it arrived on — the host
is a yes/no gate and carries no other meaning.

Session cookies are host-scoped (no `Domain=` attribute; pinned by
`lib/supabase/middleware.test.ts`), so they are never sent to a subdomain
of the canonical host.

## Emailed links

Every link the platform mails is built on the canonical host:
`siteConfig.url` in the app, the `SITE_URL` function secret in the cron edge
functions (`send-event-reminders`, `send-serving-reminders`). `SITE_URL`
must be set to the canonical origin; its in-code fallback is
`https://two42.io`.

## What was removed

- The `org_domains` registry, its `org_domain_status` enum and the
  `org_domain_worker_events` outcome log are retired from use
  (`20260920000000_retire_org_domains.sql`) and still await their drop; the
  `app_org_slug_for_host()` resolver went with `organizations.slug`
  (`20261028000000_drop_org_slug.sql`).
- The `attach-org-domains` edge function, its pg_cron job, and its Vercel
  API client.
- The org-admin custom-domain page and API, and the `/platform/domains`
  operator surface.
- Subdomain and custom-domain classification in middleware, and the
  per-org link-origin selection.

## Operator steps after deploy

These are remote project configuration; nothing in the repo performs them.

1. **Supabase Auth redirect allowlist** (dashboard → Authentication → URL
   configuration): remove `https://*.two42.io/**`, leaving
   `https://two42.io/**` and the localhost dev entry. Confirm no
   custom-domain callback entry remains.
2. **Delete the deployed `attach-org-domains` function.** CI no longer
   deploys it, which does not remove the copy already deployed. Its cron job
   is unscheduled by the migration, so it is inert until deleted.
3. **Remove the function secrets only that worker read**:
   `VERCEL_API_TOKEN`, `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID`, `PLATFORM_APEX`.
4. **Confirm the `SITE_URL` function secret** is the canonical origin.
5. **Vercel project → Settings → Domains**: remove the wildcard
   `*.two42.io` entry and any tenant custom domain still attached.
6. **Vercel env**: `NEXT_PUBLIC_PLATFORM_APEX`,
   `NEXT_PUBLIC_VERCEL_CNAME_TARGET` and `NEXT_PUBLIC_VERCEL_APEX_A_RECORD`
   are no longer read and can be deleted.
