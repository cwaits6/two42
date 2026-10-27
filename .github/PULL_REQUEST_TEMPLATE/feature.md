Closes T42-

<!-- Title: feat(<scope>): <ticket title, first letter lowercased> -->

## What someone can do now

The new behavior, from the person's side. Who (member / leader / church admin / operator) and where.

## Change

How it's built, and why it is shaped this way.

## Left untouched

<!-- Optional: adjacent things deliberately not changed. Delete if none. -->

## Tests

What was added or run. If this moves a boundary a signed-in member can see (RLS on people or content, the group frame, directory scope), name the e2e spec in `e2e/` that asserts it.

## Screenshots

<!-- Required for any UI. 390 and 1280 wide. -->

| 390 | 1280 |
|---|---|
|  |  |

## Checklist

- [ ] `npm run lint` and `npm run guard:tenancy` pass locally
- [ ] Copy uses the terms in `CONTEXT.md`
- [ ] Empty, loading, and error states exist and read differently from each other
- [ ] New service-role client or `SECURITY DEFINER` function → documented in `docs/security/service-role-inventory.md`

<!-- Schema change — delete this block if the PR adds no migration. -->
## Schema change

- [ ] This is the only open branch adding migrations
- [ ] Additive, or sequenced expand → app → contract (say which step this is)
- [ ] pgTAP coverage added or updated; `schema_tenancy_lint.sql` passes
- [ ] `lib/supabase/database.types.ts` regenerated with `npm run db:types`
