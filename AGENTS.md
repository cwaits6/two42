# Agent Notes

- Run `npm install` with local/network access when dependency resolution is required. The sandboxed install path often times out or fails DNS resolution in this repo.
- Brand and design decisions (wordmark, type, canonical color palette) live in [`docs/design/DESIGN.md`](docs/design/DESIGN.md) — the source of truth for any UI/theming work.
- `npm run lint` runs on every PR (`Lint` job in `.github/workflows/test.yml`) with `--max-warnings=0` — a warning fails the job too. The job is a required check in `main`'s branch protection, so a red `Lint` blocks the merge; run it locally before pushing.
- A change to anything a member, leader, church admin or operator sees, or to a setup step, updates the matching page under `docs-site/content/docs/` in the same PR, using the app's own copy; otherwise add the `docs-not-needed` label. The `Docs freshness` check names each page whose `sources` the change touched; [`docs-site/README.md`](docs-site/README.md) explains it.
