# Agent Notes

- Run `npm install` with local/network access when dependency resolution is required. The sandboxed install path often times out or fails DNS resolution in this repo.
- Brand and design decisions (wordmark, type, canonical color palette) live in [`docs/design/DESIGN.md`](docs/design/DESIGN.md) — the source of truth for any UI/theming work.
- `npm run lint` runs on every PR (`Lint` job in `.github/workflows/test.yml`) with `--max-warnings=0` — a warning fails the job too. The job is not yet in `main`'s branch protection, so a red `Lint` does not physically block a merge; run it locally before pushing.
