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
stack with `npx supabase start` (the pinned CLI, never the remote project)
and is the only sanctioned way to run the suite there. It runs when a change
touches `app/`, `components/`, `lib/`, `supabase/migrations/`,
`supabase/seed.sql`, `e2e/`, `playwright.config.ts`, `package.json`,
`package-lock.json`, `next.config.ts`, `proxy.ts`, `instrumentation.ts`,
`supabase/config.toml`, or the workflow file itself.

On a shared local stack the specs assume the seed default for
`directory_visibility`, and the toggle spec normalises the org to it.

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
| `group-frame.spec.ts`                | Switcher lists own groups only; a foreign `/g/<id>/…` is a 404; content stays in its group |
| `anonymous.spec.ts`                  | `/directory` and `/g/<id>/directory` redirect to `/login`                                  |

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
