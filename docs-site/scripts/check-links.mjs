import { readFile } from 'node:fs/promises';
import { glob } from 'node:fs/promises';
import GithubSlugger from 'github-slugger';
import { printErrors, scanURLs, validateFiles } from 'next-validate-link';

const CONTENT = 'content/docs';

function slugsOf(path) {
  const parts = path.slice(CONTENT.length + 1, -'.mdx'.length).split('/');
  return parts.at(-1) === 'index' ? parts.slice(0, -1) : parts;
}

// Mirrors the heading ids Fumadocs renders: plain heading text through
// github-slugger, with inline Markdown removed.
function headingIds(content) {
  const slugger = new GithubSlugger();
  const ids = [];
  let inFence = false;
  for (const line of content.split('\n')) {
    if (line.startsWith('```')) inFence = !inFence;
    const match = !inFence && /^#{2,6}\s+(.+)$/.exec(line);
    if (!match) continue;
    const text = match[1].replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*`_]/g, '');
    ids.push(slugger.slug(text));
  }
  return ids;
}

const files = [];
for await (const path of glob(`${CONTENT}/**/*.mdx`)) {
  const content = await readFile(path, 'utf8');
  const slugs = slugsOf(path);
  files.push({ path, content, slugs, url: ['/docs', ...slugs].join('/') });
}

const scanned = await scanURLs({
  preset: 'next',
  populate: {
    'docs/[[...slug]]': files.map((file) => ({ value: file.slugs, hashes: headingIds(file.content) })),
  },
});

const results = await validateFiles(files, {
  scanned,
  markdown: { components: { Card: { attributes: ['href'] } } },
});

printErrors(results, true);
