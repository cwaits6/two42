import { readFile } from 'node:fs/promises';
import { glob } from 'node:fs/promises';
import { getTableOfContents } from 'fumadocs-core/content/toc';
import { printErrors, scanURLs, validateFiles } from 'next-validate-link';

const CONTENT = 'content/docs';

function slugsOf(path) {
  const parts = path.slice(CONTENT.length + 1, -'.mdx'.length).split('/');
  return parts.at(-1) === 'index' ? parts.slice(0, -1) : parts;
}

function headingIds(content) {
  const body = content.replace(/^---\n[\s\S]*?\n---\n/, '');
  return getTableOfContents(body).map((item) => item.url.slice(1));
}

const files = [];
for await (const path of glob(`${CONTENT}/**/*.mdx`)) {
  const source = await readFile(path, 'utf8');
  const slugs = slugsOf(path);
  const url = ['/docs', ...slugs].join('/');
  // The validator skips a link with no pathname, so a same-page #anchor is
  // only checked once it names its own page.
  const content = source
    .replace(/\]\(\s*#/g, `](${url}#`)
    .replace(/href=(["'])\s*#/g, `href=$1${url}#`);
  files.push({ path, content, slugs, url, hashes: headingIds(source) });
}

const scanned = await scanURLs({
  preset: 'next',
  populate: {
    'docs/[[...slug]]': files.map((file) => ({ value: file.slugs, hashes: file.hashes })),
  },
});

const results = await validateFiles(
  files.map(({ path, content, url }) => ({ path, content, url })),
  {
    scanned,
    checkRelativePaths: 'exists',
    markdown: { components: { Card: { attributes: ['href'] } } },
  },
);

printErrors(results, true);
