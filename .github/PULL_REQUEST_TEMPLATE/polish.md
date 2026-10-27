Closes T42-

<!-- Title: fix(<scope>): <ticket title, first letter lowercased> -->

## What changes for the person using it

The difference someone will notice — wording, layout, states, readability.

## Change

What changed in code. Name any shared component or token introduced or reused.

## Left untouched

<!-- Optional: issues noticed in this area but left for another ticket. Delete if none. -->

## Screenshots

<!-- Required. Before and after, 390 and 1280 wide, for every page touched. -->

| | 390 | 1280 |
|---|---|---|
| Before |  |  |
| After |  |  |

## Checklist

- [ ] Copy uses the terms in `CONTEXT.md`; verb+noun labels; sentence case
- [ ] Text ≥ 16px (never < 14px for meaningful content); contrast ≥ 4.5:1; touch targets ≥ 44px
- [ ] Meaning never carried by color alone
- [ ] Empty, loading, and error states read differently from each other
- [ ] `npm run lint` passes locally

<!-- Schema change — delete this block if the PR adds no migration. -->
## Schema change

- [ ] This is the only open branch adding migrations
- [ ] Additive, or sequenced expand → app → contract (say which step this is)
- [ ] pgTAP coverage added or updated; `schema_tenancy_lint.sql` passes
- [ ] `lib/supabase/database.types.ts` regenerated with `npm run db:types`
