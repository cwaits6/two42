# Contributing to two42

Thanks for your interest — contributions are welcome. two42 is open source under **AGPL-3.0**.

## Before you start

- For anything non-trivial, **open an issue first** to discuss the approach.
- Contributions are accepted under the repository's AGPL-3.0 license (inbound = outbound). There is no CLA to sign.

## Workflow

- **Conventional Commits.** Only `fix`, `feat`, `perf`, and breaking changes trigger a release. Use `chore:` / `docs:` / `ci:` for everything else.
- Keep pull requests focused and reviewable.
- Issue titles, labels, and PR templates: [`docs/contributing/issues-and-prs.md`](./docs/contributing/issues-and-prs.md). Product vocabulary: [`CONTEXT.md`](./CONTEXT.md).
- Match the surrounding code — its naming, structure, and comment density.

## Database & migrations

- Migrations are timestamped SQL in `supabase/migrations/` and must stay **additive**.

## Design & UI

- Follow [`docs/design/DESIGN.md`](./docs/design/DESIGN.md): the wordmark, type, color, and the accessibility floor.
- Plain, functional copy — verb+noun labels, no salesy subtitles.

See also `AGENTS.md` and `CLAUDE.md` for repo conventions.
