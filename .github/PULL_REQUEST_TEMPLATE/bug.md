Closes T42-

<!-- Title: fix(<scope>): <ticket title, first letter lowercased> -->

## What was wrong

What the person saw, and how to reproduce it.

## Root cause

Why it happened — the actual defect, not the symptom.

## Fix

What changed, and why this is the right place to fix it.

## Left untouched

<!-- Optional: related problems noticed but not fixed here, with a ticket if one was opened. Delete if none. -->

## Tests

- [ ] A test that fails before this change and passes after it: `<path>`
- [ ] Other suites run:

## Checklist

- [ ] `npm run lint` and `npm run guard:tenancy` pass locally
- [ ] User-visible error and empty states still distinguish "failed" from "nothing here"

<!-- Schema change — delete this block if the PR adds no migration. -->
## Schema change

- [ ] This is the only open branch adding migrations
- [ ] Additive, or sequenced expand → app → contract (say which step this is)
- [ ] pgTAP coverage added or updated; `schema_tenancy_lint.sql` passes
- [ ] `lib/supabase/database.types.ts` regenerated with `npm run db:types`
