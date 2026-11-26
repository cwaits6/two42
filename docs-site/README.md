# two42 docs site

The documentation site for two42: how to use, administer, run and develop it. It is a [Fumadocs](https://fumadocs.dev) site on Next.js, built as a static export, separate from the app in the folder above. It imports nothing from the app.

## Run it locally

Node 26, from this folder:

```bash
npm ci
npm run dev -- -p 3801
```

Pick any free port above 3800, then open `http://localhost:3801/docs`.

## Check it

```bash
npm run types:check   # TypeScript
npm run check:links   # every internal link and #heading in the content and the landing page
npm run check:sources # every page lists sources, and every glob matches a tracked file
npm test              # unit tests for the scripts in scripts/
npm run build         # static export to out/
```

CI runs all of them in `.github/workflows/docs-site.yml`.

## Keep the pages current

Every page under `content/docs/` except the `index.mdx` pages lists, in its frontmatter, the files it describes:

```yaml
sources:
  - "app/g/[groupId]/announcements/**"
  - "components/announcements/**"
  - "lib/announcements.ts"
```

- Globs are relative to the repository root. Only `*` (within one folder) and `**` (any number of folders) are special, so route folders such as `[groupId]` and `(auth)` are written as they are. Write the list one `- "glob"` per line.
- Keep each glob as narrow as the page: the routes, components, lib modules, edge functions and setup files behind what it describes. Never list `package.json`, a lockfile or anything under `.github/`, so dependency updates pass on their own.
- `npm run check:sources` fails when a page has no list or a glob matches no tracked file, naming the page and the glob. The frontmatter schema in `lib/source.ts` type-checks the list in the build.

The **Docs freshness** check (`.github/workflows/docs-freshness.yml`) runs on every pull request. It fails when a changed file matches a page's `sources` and that page did not change, and prints each page to check with the changed paths that matched it. Test files (`*.test.*`, `*_test.ts`, `__snapshots__/`) never count. The logic is in `scripts/docs-sources.mjs`.

When a change touches a listed file but nobody can see the difference, add the `docs-not-needed` label to the pull request. The check re-runs when the label is added or removed, and passes while it is on.

## Where things live

- `content/docs/` holds the pages as MDX, one folder per section (`use`, `administer`, `run`, `develop`). Each folder's `meta.json` sets the page order.
- `app/global.css` maps the two42 palette from `docs/design/DESIGN.md` onto the Fumadocs theme, light and dark.
- `public/brand/` holds copies of the app's wordmark and mark SVGs (`public/brand/` in the app), and `app/icon.svg` is a copy of the app's `app/icon.svg`. Nothing keeps them in step: when the app's brand files or the palette in `docs/design/DESIGN.md` change, update these copies and `app/global.css` in the same change.
