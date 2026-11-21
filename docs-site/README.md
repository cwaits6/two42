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
npm run build         # static export to out/
```

CI runs all three in `.github/workflows/docs-site.yml`.

## Where things live

- `content/docs/` holds the pages as MDX, one folder per section (`use`, `administer`, `run`, `develop`). Each folder's `meta.json` sets the page order.
- `app/global.css` maps the two42 palette from `docs/design/DESIGN.md` onto the Fumadocs theme, light and dark.
- `public/brand/` holds copies of the app's wordmark and mark SVGs (`public/brand/` in the app), and `app/icon.svg` is a copy of the app's `app/icon.svg`. Nothing keeps them in step: when the app's brand files or the palette in `docs/design/DESIGN.md` change, update these copies and `app/global.css` in the same change.
