Closes T42-

<!-- Title = the ticket title: <type>(<scope>): <imperative summary>
     Bug, feature, or polish ticket? Use that template instead:
     docs/contributing/issues-and-prs.md#pull-requests -->

## Change

What changed and why it is shaped this way.

## Left untouched

<!-- Optional: adjacent things deliberately not changed. Delete if none. -->

## Tests

What was added or run.

## Checklist

- [ ] `npm run lint` and `npm run guard:tenancy` pass locally
- [ ] New service-role client or `SECURITY DEFINER` function → documented in `docs/security/service-role-inventory.md`

<!-- Schema change — delete this block if the PR adds no migration. -->
## Schema change

- [ ] This is the only open branch adding migrations
- [ ] Additive, or sequenced expand → app → contract (say which step this is)
- [ ] pgTAP coverage added or updated; `schema_tenancy_lint.sql` passes
- [ ] `lib/supabase/database.types.ts` regenerated with `npm run db:types`
