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
`supabase/config.toml`, `scripts/start-supabase-stack.sh`, or the workflow file
itself. The job reserves the stack's ports as its first step, and that script
retries the start once if it fails on a port bind.

On a shared local stack the specs assume the seed defaults for
`directory_visibility`, `group_creation_policy` (`approval`) and
`group_discovery` (on), and that no group is private; the four specs that
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
no team lead. `prayer-anonymity.spec.ts` posts one request through the page, its author
deletes it through the page in the last test, and the same container removes it
in `beforeAll` and `afterAll` if a test stops first. `account-deletion.spec.ts`
never deletes a seeded person: it creates its own people through the same
container, deletes them through the pages, and removes any left in `afterAll`. `serving-cancel.spec.ts` builds a Group B team (Leo as its
lead, Henry, Chloe and Isaac as members) through the same container in
`beforeAll`, puts Henry and Chloe's date back before each test, and deletes the
team in `afterAll`. `event-replies.spec.ts` adds two past Group B events with Zoe's reply through the same
container in `beforeAll`, writes Isaac's and Zoe's Sunday Class replies through the pages, and removes
those replies and events in `beforeAll` and `afterAll`. `serving-dates-couples.spec.ts` builds a Group B team on a
set block of 30 Sundays (Leo as its lead, Isaac as a member) through the same
container in `beforeAll`, adds Henry and Chloe through the page, shortens the
block in its last test, and deletes the team in `afterAll`. `directory-no-hide-settings.spec.ts` changes the Mockingham
household and Chloe's profile through the page and the same container, and puts
their seeded values back in `afterAll`. `children-directory.spec.ts` adds a child
to the Mockingham household through the page, inserts an invited adult and an
approved access request through the same container, and deletes those rows there
in `beforeAll` and `afterAll`. `anniversaries-unlisted-couple.spec.ts` opens the
directory to the whole church, adds a household record claimed by Chloe to the
Mockingham household, moves the household's anniversary to within two days of
today in the church's time zone and unlists Henry and Chloe through the same
container, because the seed has no claimed spouse record; it deletes the record
and puts the seeded listing, anniversary and `directory_visibility` back in
`beforeAll` and `afterAll`. `hidden-email.spec.ts` turns Chloe's email setting
on through the same container in `beforeAll` and puts the seed default (off)
back in `afterAll`. `group-settings.spec.ts` makes Zoe a leader of Group C and
inserts Amelia's request to join Group B and Isaac's to join Group C through
the same container in `beforeAll`, and deletes those rows, Zoe's Group C leadership and the Group C membership
its approval gives Isaac in `beforeAll` and `afterAll`.

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
| `householdPrimary` | henry.mockingham@example.test | A, B          |
| `spouse`    | chloe.mockingham@example.test     | A, B              |
| `operator`  | platform@local.dev                | none; no church and no profile |

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
| `group-creation-policy.spec.ts`      | The org's create policy decides whether a member sees "Request a group", "Add a group" or neither; restored to approval in afterAll |
| `group-discovery.spec.ts`            | A private group is listed for its members and tagged for the org admin but absent for everyone else, and its deep link stays a 404; the org switch removes Find a group and every other group; both restored in afterAll |
| `admin-join-queue.spec.ts`           | A join request for a group the org admin does not lead is counted on Admin › Requests and listed there under its group; Decline (confirmed in the dialog) removes it, lowers the count and leaves the requester out; a second request approved gains the requester the group in their switcher and lowers the count; the request and membership rows are deleted in afterAll |
| `group-invite.spec.ts`               | A leader's invite link names the group and offers the signup form to a stranger until it is revoked, after which the same URL shows the one dead-link message and no form; a non-member gets a 404 on the invites page; the created link is revoked in afterAll |
| `pending-group-access.spec.ts`       | A member moved back to pending gets a 404 on their group's pages and the pending card at Home; while pending the account menu offers only Help, Privacy, Terms and Sign out; approved again, the same group's announcements show with no re-adding and My profile and Settings are back; set back to member in afterAll |
| `signed-in-frame.spec.ts`            | At 390 and at 1280 a one-group member, a two-group member, a leader, the church admin and the operator each get an account menu with exactly their rows, and the members their exact page list, with Group settings for the leader alone, and inside Group settings the leader gets its six sections under the way back to the group: Church admin is offered only to the church admin and Platform only to the operator, and a member is offered neither; at 390 the bar holds the wordmark and one Menu button and the group switcher is inside the menu, at 1280 there is no Menu button; a member of two groups has one Home inside a group and reaches all groups from the switcher's first row and the wordmark; nobody signed in has a footer; signed in, everyone but the operator lands on Home from `/login` and `/forgot-password`; signing out from the account menu ends the session on that device and says so when the server could not be told |
| `fund-pickers.spec.ts`               | A leader of two groups, a church admin and a member are offered only the current group's members in a fund's pickers, and nobody from another church; a church admin who can read an unlisted member isn't offered them; a fund in "Needs review" or "Needs a recipient" is off Give for a member, and a leader sees its status and can reach it; the rows created are removed in afterAll |
| `about-leadership-picker.spec.ts`    | Edit About's leadership picker lists the group's members and no one from another group, and its save answers 409 for someone outside the group; nothing is written |
| `team-lead-roster.spec.ts`           | A team lead who does not lead the group has Serving among the group's pages and sees the team's members with Remove on non-leads only; Add person lists the group's members not on the team and no one from another group; an add and a remove go through; a group member not on the team sees no roster controls; with serving signups off the Serving page links the team for its lead, who still gets the roster, while that member sees no link and is sent back to the Serving page; the team is deleted in afterAll |
| `prayer-anonymity.spec.ts`          | A member, the group's leader and a church admin in the group see an anonymous request as "Anonymous", with no author name, no "You" and no "Mark answered", and not under My requests; its author sees it as theirs, under My requests, and can mark it answered; a request shared by name still shows the name; only the author sees Delete, by name or anonymous, and deleting takes a confirmation; the request is deleted in afterAll |
| `account-deletion.spec.ts`          | A person the spec created deletes their account from Settings, the confirmation naming the fund left with no recipient and what the download leaves out, and can't sign in afterwards; their download holds their own anonymous request and no other member; a fund with a second person goes to them, needing review, and the confirmation says so; a church admin's row menu offers Delete account on others and not on their own row, the route refuses their own id, deleting someone leaves no row for them on Members, and the last church admin is told so with no confirmation offered; a member is refused the admin route and a church admin gets a 404 for someone in another church, with both people still there; the people created are removed in afterAll |
| `serving-dates-couples.spec.ts`     | A team lead adding someone whose spouse is in the group is asked "Also add …?" and Add both puts both on the team; Team settings shows the block's "30 Sundays"; the schedule lists every Sunday of the block with "30 open dates through …", and a crafted request for a date outside the block is refused; a spouse is asked who is serving and about the next week in one dialog and books both weeks for both, with no question on the block's last date; the other spouse sees "You & Henry" and can switch a date to just them; a member with no spouse sees the couple by name, has no Change, and is asked only about the next week; a team lead whose block ends within two weeks gets "Greeters needs more dates" on Home and a member does not; once the spouse is off the team, the member is not asked who is serving and signs up alone; the team is deleted in afterAll |
| `serving-cancel.spec.ts`            | A spouse listed on a date, who did not tap Sign up, cancels it from the team schedule at 390 and 1280 and the date opens up; the person who tapped Sign up, the team lead and the group leader can each still cancel it; a team member not listed sees no Cancel or Remove button and the API refuses them with the date still taken; the team is deleted in afterAll |
| `directory-no-hide-settings.spec.ts` | No hide setting but email and the listing on the profile, household and admin forms at 390 and 1280; a yearless anniversary shows month and day with no "Married"; a couple where a spouse hid it is on no Anniversaries filter; the email and listing settings remove the email and the person; the household phone shows a spouse's number under their name, follows them clearing it, and either spouse can clear the choice; the seed is restored in afterAll |
| `children-directory.spec.ts`         | A child's Year field is gone from the add form, which says entered details are shown and that a child can't be invited; a child with only a name shows only that name to a member in the same group, with no "Child" label and no birthday; a seeded child's birthday shows without a year; the household's primary and the church admin still list and manage the children; the household invite and account setup forms state the 13 or older requirement; the added rows are deleted in afterAll |
| `anniversaries-unlisted-couple.spec.ts` | Under "Everyone in …", a couple who are both listed has one Anniversaries row on every filter; a listed primary whose claimed spouse is unlisted keeps a row that names only the primary, and a couple who are both unlisted has none and no household name on the page; a listed primary whose spouse has no account keeps their row; the claimed record is deleted and the seed restored in afterAll |
| `hidden-email.spec.ts`               | A member in the same group sees a person who hides their email with no email on their card, and still sees a visible one; the household's primary is shown their spouse's setting and no Email field; the person sees their own email on My profile; a church admin sees it in Members and in the Email field of that person's edit page; the setting is turned back off in afterAll |
| `event-replies.spec.ts`              | At 390, a member answering Going on the first Sunday Class date in List leaves the second date with no reply chosen; List shows 10 dates and Show more dates adds 10, reaching later months; the leader answering the second date on its page is the only name under Who's coming there, and the member is the only one on the first date; a past one-time event and a past date of a repeating event show no reply buttons and still list who said they were going; choosing the current reply again clears it on that date, and the other date keeps its own; one member answering Going on the first date and Can't go on the second in List keeps both after a reload, and is listed under Who's coming on the first date only; the replies and the two past events are removed in afterAll |
| `group-settings.spec.ts`             | A leader of two groups sees the number of requests to join waiting on their Group settings row and on Requests, for the group they are in only; inside Group settings the sections are one click apart; each group's Requests lists its own requester and not the other group's; declining on one and approving on the other removes each and its count; Group settings opens on Details and the old serving settings address on Teams; a member of the group who opens any Group settings address lands on the group's Home with no Group settings row and no request shown; the rows created are deleted in afterAll |

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
