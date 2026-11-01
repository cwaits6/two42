# Browser guard rails

Playwright specs, Chromium only, that prove what a signed-in member actually
sees at the tenancy and visibility boundaries. pgTAP proves the rules at the
SQL layer (`supabase/tests/`); these specs assert the rendered consequence of
the same rules and nothing else.

## Running

```bash
npm run test:e2e
```

The config builds the app (`next build && next start`) on port 3142 and runs
against whatever Supabase the build's env points at — locally, the shared
stack on `:54321`, whose seed is already applied. Nothing is reset. Set
`E2E_PORT` if 3142 is taken, or `E2E_BASE_URL` to use a server that is
already up. `npx playwright show-report` opens the last HTML report.

In CI the `e2e` job in `.github/workflows/test.yml` stands up an ephemeral
stack with `npx supabase start` (the pinned CLI, never the remote project),
hands the build that stack's own service key (the token pages read their
anchor row on the service client), and is the only sanctioned way to run the
suite there. It runs when a change
touches `app/`, `components/`, `lib/`, `supabase/migrations/`,
`supabase/seed.sql`, `e2e/`, `playwright.config.ts`, `package.json`,
`package-lock.json`, `next.config.ts`, `proxy.ts`, `instrumentation.ts`,
`supabase/config.toml`, or the workflow file itself.

On a shared local stack the specs assume the seed defaults for
`directory_visibility`, `group_creation_policy` (`approval`) and
`group_discovery` (on), and that no group is private; the three specs that
change those settings normalise them back in `beforeAll` and `afterAll`.
`admin-join-queue.spec.ts` is the one spec that inserts rows — a join request
and the membership its approval creates — and it deletes both in `beforeAll`
and `afterAll` through the stack's Postgres container
(`supabase_db_small-group-hub`, the name `supabase start` derives from
`config.toml`), because no UI deletes a reviewed request. `pending-group-access.spec.ts`
moves Isaac to pending and back through the same container, and sets him
back to member in `beforeAll` and `afterAll`. `team-lead-roster.spec.ts`
builds a Group B team (Leo as its lead, Henry as a member) through the same
container in `beforeAll` and deletes it in `afterAll`, because the seed has
no team lead. `prayer-anonymity.spec.ts` posts one request through the page and
deletes it through the same container in `beforeAll` and `afterAll`, because no
UI deletes a request.

## Personas

Every persona comes from `supabase/seed.sql` and signs in with
`password123`. The fixture in `fixtures/auth.ts` signs in through the real
`/login` form once per persona and caches the browser storage state under
`e2e/.auth/` (gitignored, reused for 30 minutes). Delete that directory if a
persona looks signed out.

| Key         | Account                           | Groups            |
| ----------- | --------------------------------- | ----------------- |
| `admin`     | admin@local.dev                   | leads A, member B |
| `oneGroup`  | isaac.seedly@example.test         | B                 |
| `twoGroups` | leo.loremsworth@example.test      | B, C              |
| `leadsC`    | amelia.demoski@example.test       | leads C           |
| `leadsB`    | zoe.dummyfield@example.test       | leads B           |

Group B and Group C are addressed by the fixed ids the seed inserts
(`fixtures/personas.ts`). Group A is the migration-created group and has no
fixed id, so no spec addresses it by URL. The seed has no `pending` account
linked by a family-invite claim, so that half of the household boundary is
not covered here.

## Specs

| Spec                                 | Boundary                                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------------ |
| `directory-scope.spec.ts`            | Scope control absent for a one-group member; options, roster, tab carry-over, search       |
| `directory-visibility-toggle.spec.ts`| The org-wide switch adds and removes "Everyone in …"; outsiders marked; left off in afterAll   |
| `household-boundary.spec.ts`         | Only households sharing a group are listed; a deep link to another's opens nothing         |
| `group-frame.spec.ts`                | Switcher lists own groups only; a foreign `/g/<id>/…` is a 404, while Admin › Groups opens that group's page for the church admin with its leader and members; content stays in its group |
| `anonymous.spec.ts`                  | `/directory` and `/g/<id>/directory` redirect to `/login`                                  |
| `group-creation-policy.spec.ts`      | The org's create policy decides whether a member sees "Request a group", "Create a group" or neither; restored to approval in afterAll |
| `group-discovery.spec.ts`            | A private group is listed for its members and tagged for the org admin but absent for everyone else, and its deep link stays a 404; the org switch removes Find a group and every other group; both restored in afterAll |
| `admin-join-queue.spec.ts`           | A join request for a group the org admin does not lead is counted on the Admin overview and listed under its group on Admin › Groups; Decline (confirmed in the dialog) removes it and leaves the requester out; a second request approved gains the requester the group in their switcher and clears the overview count; the request and membership rows are deleted in afterAll |
| `group-invite.spec.ts`               | A leader's invite link names the group and offers the signup form to a stranger until it is revoked, after which the same URL shows the one dead-link message and no form; a non-member gets a 404 on the invites page; the created link is revoked in afterAll |
| `pending-group-access.spec.ts`       | A member moved back to pending gets a 404 on their group's pages and the pending card at Home; approved again, the same group's announcements show with no re-adding; set back to member in afterAll |
| `signed-in-frame.spec.ts`            | At 390 a one-group member, a two-group member and the church admin get the same header — the wordmark and one Menu button, no footer — and the menu holds their nav, Privacy, Terms, Help and one Sign out; the group switcher is inside the menu; signed in, `/login` and `/forgot-password` land on Home |
| `about-leadership-picker.spec.ts`    | Settings → About's leadership picker lists the group's members and no one from another group, and its save answers 409 for someone outside the group; nothing is written |
| `team-lead-roster.spec.ts`           | A team lead who does not lead the group sees the team's members with Remove on non-leads only; Add person lists the group's members not on the team and no one from another group; an add and a remove go through; a group member not on the team sees no roster controls; with serving signups off the Serving page links the team for its lead, who still gets the roster, while that member sees no link and is sent back to the Serving page; the team is deleted in afterAll |
| `prayer-anonymity.spec.ts`          | A member, the group's leader and a church admin in the group see an anonymous request as "Anonymous", with no author name, no "You" and no "Mark answered", and not under My requests; its author sees it as theirs, under My requests, and can mark it answered; a request shared by name still shows the name; the request is deleted in afterAll |

## Adding a spec

Boundaries only. A spec earns its place when loosening a policy, a scope rule,
or a route guard would make it fail; layout, copy and click-through coverage
do not belong here. Before writing one:

1. Pick the seeded persona the boundary is about; add one to
   `fixtures/personas.ts` only if none fits.
2. Set it with `test.use({ persona: "…" })`; use `openAs()` for a second
   actor in the same test or hook.
3. Assert on visible names, options and counts with role and name locators.
   Reach for `data-testid` only where no accessible locator exists.
4. Restore any state the spec mutates in `afterAll`, so a failed assertion
   does not leave the shared local stack drifted.
5. Loosen the rule locally once, watch the spec fail, restore it, and say
   which rule in the PR body.

## Promotion to a required check

The job is not in the "Protect main" ruleset. Add it only after ten
consecutive green runs on `main`, so a flaky selector cannot block an
unrelated merge. If it turns flaky after that, it is removed, not retried
into submission. A run where the path gate skipped the job still reports
green, so count only runs whose step summary says "Playwright boundaries: ran"
toward the ten. `supabase start` in the job pulls six images from a public
registry and has already hit a transient "Data limit exceeded" that the CLI
retried through, so diagnose a future flake as registry quota before suspecting
a selector.
