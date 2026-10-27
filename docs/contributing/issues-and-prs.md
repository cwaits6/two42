# Issues, projects, and pull requests

Linear (team **two42**, key `T42`) is the source of truth for planned work; it syncs both ways with GitHub Issues. Everything here applies equally to tickets written by people and by agents.

Use the words in [`CONTEXT.md`](../../CONTEXT.md) in titles and bodies — the ticket's vocabulary becomes the PR's, and the PR's becomes the product's.

---

## Projects

A project is a body of work with an end state. Name it so it is recognizable months later from the name alone.

- **Name the outcome or the system**, the way you'd say it out loud: 2–5 words, sentence case. `App-wide polish`, `Group model v2`, `Self-hosting kit`.
- **Never** put ticket ids, dates, phase numbers, or catch-alls (`Misc`, `Cleanup`, `Stuff`) in the name.
- Add `v2`, `v3` only when the project replaces an existing system wholesale.
- **Summary** (the one-line field): `Done when …` — one sentence.
- **Description** sections: `Goal`, `Scope`, `Out of scope`, `Milestones`, `Done when`.
- **Milestones** are ordered checkpoints, named `<n>. <noun phrase>` — `1. Shared foundations`, `2. Per-area polish`.

A ticket that doesn't advance any project's end state stays project-less; don't invent a project to hold it.

---

## Labels

Every ticket gets exactly one **Type**, at least one **Surface**, and any **Risk** flags that apply.

**Type** — what kind of work it is. Each maps to one conventional-commit type, which is what decides whether it ships a release:

| Type | Commit type | Releases? | Meaning |
|---|---|---|---|
| `bug` | `fix` | yes | Something behaves wrongly or loses data |
| `polish` | `fix` | yes | Works, but reads, looks, or feels wrong to the person using it |
| `feature` | `feat` | yes | Someone can do something they couldn't before |
| `perf` | `perf` | yes | Faster or cheaper, same behavior |
| `refactor` | `refactor` | no | Code structure changes; nobody can see a difference |
| `chore` | `chore` | no | Tooling, dependencies, seed data, housekeeping |
| `docs` | `docs` | no | Documentation only |
| `ci` | `ci` | no | Workflows and pipeline config |

`bug` and `polish` both ship as `fix:` — the label keeps them separable in Linear. A change that both restructures code and changes what users see is `polish` or `feature`, not `refactor`.

**Surface** — whose experience it changes: `member` · `leader` · `admin` (church admin) · `platform` (operator). When surfaces compete, they're prioritized in that order.

**Risk** — `migration` (adds a file under `supabase/migrations/`; only one in-flight branch may, so filter open `migration` tickets before starting one) · `tenancy` (touches an `org_id` boundary, a service-role client, or a `SECURITY DEFINER` function) · `security`.

---

## Issue template

**Title** — plain English, written as the change to make:

- Imperative, sentence case, no trailing period, under ~70 characters.
- Says what changes for the person, not how the code changes: `Keep member rows on one line on phones`, not `Fix flex-wrap in DirectoryRow`.
- Bugs name the correct behavior, so the fix reads as the title: `Delete only the chosen date of a repeating event`, not `Series delete bug`.
- No type prefix, scope, ticket id, or `[WIP]` — the Type label carries the type, and the PR adds the prefix.

```markdown
## Problem
What's wrong or missing, from the person's side. One paragraph.

## Who
member | leader | church admin | operator — and where (route or surface).

## Proposal
The change, plainly. Decisions already made, with dates.

## Acceptance
- [ ] Observable outcomes: copy, counts, states, viewports (390 and 1280).

## Out of scope
(Optional — include only when an adjacent change is tempting.)

## Constraints
(Optional — migrations, tenancy, e2e boundary spec, DESIGN.md floors.)

## References
Related issues, PRs, files (`path:line`).
```

Rules:

- **Edit the sections; don't append.** No `Added <date>:` addenda at the bottom — fold new information into Problem / Proposal / Acceptance, or open a new ticket.
- No `Phase` footers or tracking tags in the body's prose.
- Acceptance items are things a reviewer can check by looking, not "code is clean".

---

## Pull requests

**Title** is a conventional commit built from the ticket, because it becomes the squash-merge commit that release-please reads:

```
<type>(<scope>): <ticket title, first letter lowercased>

T42-114  Keep member rows on one line on phones   (polish)
PR       fix(directory): keep member rows on one line on phones
```

- `<type>` comes from the ticket's Type label (table above).
- `<scope>` is the area of the app: `directory`, `calendar`, `events`, `serving`, `giving`, `lessons`, `announcements`, `profile`, `auth`, `admin`, `platform`, `email`, `shell`, `ui`, `db`. Reuse an existing scope from `git log` before inventing one.
- Breaking changes add `!` after the scope and a `BREAKING CHANGE:` footer.

**Body** starts with `Closes T42-NN`.

Pick the template by the ticket's Type label:

| Type | Template |
|---|---|
| `bug` | [`.github/PULL_REQUEST_TEMPLATE/bug.md`](../../.github/PULL_REQUEST_TEMPLATE/bug.md) |
| `feature` | [`.github/PULL_REQUEST_TEMPLATE/feature.md`](../../.github/PULL_REQUEST_TEMPLATE/feature.md) |
| `polish` | [`.github/PULL_REQUEST_TEMPLATE/polish.md`](../../.github/PULL_REQUEST_TEMPLATE/polish.md) |
| everything else | [`.github/pull_request_template.md`](../../.github/pull_request_template.md) |

GitHub pre-fills only the default template, and only in the web UI; a PR opened through the API or `gh pr create --body-file` gets no template at all. Agents copy the matching file's structure into the body they write. In the web UI, append `?template=bug.md` (or `feature.md`, `polish.md`) to the compare URL.

Every template ends with an optional **Schema change** block — delete it when the PR adds no migration.
