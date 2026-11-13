# Privacy policy and Terms of service

The two documents published at [`/privacy`](../../app/privacy/page.tsx) and
[`/terms`](../../app/terms/page.tsx) cover the hosted service at two42.io. They
are a first draft: the maintainer owns the wording, and a lawyer should check
it before it is relied on.

## Where the text lives

| Document | Text | Page |
|---|---|---|
| Privacy policy | [`components/legal/privacy.ts`](../../components/legal/privacy.ts) | `app/privacy/page.tsx` |
| Terms of service | [`components/legal/terms.ts`](../../components/legal/terms.ts) | `app/terms/page.tsx` |

Each file is plain data, no React. A document has a `title`, a one-line
`summary`, a `lastUpdated` date and a list of `sections`. Each section has a
`heading` and `blocks`:

- a string is a paragraph;
- an array of strings is a bulleted list;
- `[text](href)` inside either is a link. A link starting with `/` stays on two42.

`components/legal/LegalPage.tsx` renders both, adds the "Last updated" line,
the link to the other document and the Basecamp / CC BY 4.0 attribution at the
bottom. Keep that attribution while any of the structure adapted from the
[Basecamp policies](https://github.com/basecamp/policies) remains.

## Updating a document

1. Edit the text in `components/legal/privacy.ts` or `terms.ts`.
2. Set `lastUpdated` in that file to the day the change is published
   (`YYYY-MM-DD`). It is the only place the date is written.
3. Run `npx vitest run components/legal`. It fails if a page says "being
   written", has no date, drops a processor, loses the attribution, or shows a
   bracketed placeholder.
4. Never put a `[bracketed placeholder]` on the public page. Open choices live
   in this file; the public text says only what is already true.

The public commit history of each file is the record of what changed.

## What to re-check when a feature changes

Every sentence in the Privacy policy must be true of the code on `main`. When a
change touches any of the following, re-read the matching sentences and check
them against the files listed.

- [ ] **Processors.** A new outside service the app or browser talks to:
  grep `app/`, `components/`, `lib/` and `supabase/functions/` for `https://`,
  and read the CSP in `lib/supabase/middleware.ts`. Add it to `PROCESSORS` in
  `privacy.ts`, and to the processor test in `components/legal/LegalPage.test.ts`.
  Also check whether production sets `OTEL_EXPORTER_OTLP_ENDPOINT`
  (`instrumentation.ts`): if it does, that tracing service is a processor.
- [ ] **Analytics.** `components/analytics/PageMeasurement.tsx` and
  `lib/analytics/pagePattern.ts`: Web Analytics must still receive page patterns
  only. Speed Insights (`@vercel/speed-insights`) is installed but not loaded;
  loading it adds a sentence.
- [ ] **Stored data.** A new table or column that holds something a person
  entered: `lib/supabase/database.types.ts`, the profile fields in
  `lib/profileColumns.ts`, and the storage kinds in `lib/storagePaths.ts`.
- [ ] **Who sees it.** `docs/security/roles-and-permissions.md` (the role
  table and "Settings that change what a role can do"), the directory rules,
  and `hide_email` / `is_unlisted`.
- [ ] **Retention.** `supabase/functions/_shared/retention.ts` and
  `supabase/functions/_shared/cleanup.ts`: every period in "How long it is
  kept" comes from there, and the prayer request choices from
  `organizations.prayer_request_retention_months`.
- [ ] **Deletion and download.** `lib/account/deletionCopy.ts` (what goes and
  stays, `DOWNLOAD_COVERS`, `DOWNLOAD_LEAVES_OUT`), `lib/account/deletion.ts`
  and `lib/account/export.ts`. Removing a whole church is not built; the policy
  only says a church admin can ask.
- [ ] **Anonymity wording.** `supabase/migrations/20261109000000_prayer_author_private.sql`
  and the prayer page. Never say two42 cannot read prayer requests or cannot
  identify an anonymous author: the operator holds database access, and would
  hold any key. See the draft notes below.
- [ ] **Email.** `lib/email/` and the edge functions: the kinds of email listed
  under Resend.
- [ ] **Vocabulary.** [`CONTEXT.md`](../../CONTEXT.md): church admin, leader,
  household, event, lesson, usage.

## Draft notes: when prayer encryption lands

A change in flight encrypts prayer request text and removes the author of an
anonymous request from the database. None of it is on `main` yet, so the
policy does not describe it. When it merges, re-check each sentence below in
`components/legal/privacy.ts` against what it actually does, and rewrite it:

| Section | Sentence | What to re-check |
|---|---|---|
| What two42 stores | "Prayer requests you post, by name or anonymous, and the requests you say you are praying for." | Whether the author of an anonymous request is still stored anywhere, and that the text is stored encrypted. |
| Who can see it | "An anonymous request shows no author in the app to anyone but the author: not to other members, leaders or church admins." | Whether the author still sees it as theirs, and how. |
| Who can see it | "A leader can edit or delete any prayer request in their group." | Whether a leader can still edit an encrypted request. |
| What Cody Waits can see | "…can read everything stored in it, including prayer requests and who wrote an anonymous one." | Rewrite to say the text is encrypted and who holds the key. Keep saying the operator holds the key and so could read it; never say reading it or identifying an author is impossible. |
| Your copy and your account | "The file holds … prayer requests …" | Whether the download still includes the person's anonymous requests. |
| Your copy and your account | "You can delete your own prayer requests …" | Whether an author can still find and delete an anonymous request. |
| Your copy and your account | "Deleting an account removes … prayer requests, including anonymous ones." | Whether account deletion can still find anonymous requests once the author is gone. |
| Services that handle your data | Supabase | Where the encryption key is kept, and whether that adds a processor. |

## Open choices for the maintainer

Each is a commitment the code does not enforce. The public text says only what
is true without it; fill one in here, then add the sentence to the document.

- [MAINTAINER: how quickly a privacy request sent to privacy@two42.io is answered]
- [MAINTAINER: how long Supabase backups are kept on the project's plan, so "until they expire" can name a period]
- [MAINTAINER: where data is stored — the Supabase project's region and Vercel's function region]
- [MAINTAINER: how and how far ahead people are told about a significant change to either document]
- [MAINTAINER: how long to remove a church's data after a church admin asks, and whether that is done by hand]
- [MAINTAINER: how a requester's identity is checked before a copy or removal is sent]
- [MAINTAINER: how long privacy request emails are kept]
- [MAINTAINER: the governing law and venue for the Terms]
- [MAINTAINER: confirm the commitment that database access is used only to run the service, fix a problem, answer a request, or comply with the law]
- [MAINTAINER: confirm hello@two42.io for questions about the Terms and security@two42.io for security reports]
- [MAINTAINER: whether production sets OTEL_EXPORTER_OTLP_ENDPOINT, and if so which service receives traces]
- [MAINTAINER: whether the hosted Supabase Auth sends password reset email through its own mailer or through Resend as custom SMTP]
