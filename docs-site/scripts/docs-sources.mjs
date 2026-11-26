import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { posix } from 'node:path';
import { frontmatter } from 'fumadocs-core/content/md/frontmatter';

export const SKIP_LABEL = 'docs-not-needed';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CONTENT_DIR = 'docs-site/content/docs';

// A test or snapshot change on its own never changes what anyone sees.
const TEST_FILE = /(\.test\.[cm]?[jt]sx?|_test\.ts)$|\/__snapshots__\//;

// Only * and ** are special, so route folders such as [groupId] and (auth)
// can be written as they appear on disk.
export function globToRegExp(glob) {
  let pattern = '';
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    if (char === '*' && glob[i + 1] === '*') {
      i++;
      if (glob[i + 1] === '/') {
        i++;
        pattern += '(?:.*/)?';
      } else {
        pattern += '.*';
      }
    } else if (char === '*') {
      pattern += '[^/]*';
    } else {
      pattern += char.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  // Every metacharacter but * is escaped above, and globs come from the pages.
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
  return new RegExp(`^${pattern}$`);
}

export function isIndexPage(page) {
  return posix.basename(page) === 'index.mdx';
}

export function readPages(root = REPO_ROOT) {
  const dir = posix.join(root.replaceAll('\\', '/'), CONTENT_DIR);
  return readdirSync(dir, { recursive: true })
    .map((file) => file.replaceAll('\\', '/'))
    .filter((file) => file.endsWith('.mdx'))
    .sort()
    .map((file) => {
      const page = `${CONTENT_DIR}/${file}`;
      const { data } = frontmatter(readFileSync(posix.join(dir, file), 'utf8'));
      return { page, sources: data.sources ?? null };
    });
}

export function trackedFiles(root = REPO_ROOT) {
  return execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
}

// Every problem with the pages' sources lists: a page with none, or a glob
// that matches no tracked file.
export function findSourceProblems(pages, files) {
  const problems = [];
  for (const { page, sources } of pages) {
    if (!sources || sources.length === 0) {
      if (!isIndexPage(page)) problems.push({ page, message: 'has no sources list' });
    } else {
      for (const glob of sources) {
        const re = globToRegExp(glob);
        if (!files.some((file) => re.test(file))) {
          problems.push({ page, message: `glob matches no tracked file: ${glob}` });
        }
      }
    }
  }
  return problems;
}

// The pages whose listed paths changed while the page itself did not, each
// with the changed paths that matched it.
export function findStalePages(pages, changed, labels = []) {
  if (labels.includes(SKIP_LABEL)) return { skipped: true, stale: [] };
  const changedSet = new Set(changed);
  const relevant = changed.filter((file) => !TEST_FILE.test(file));
  const stale = [];
  for (const { page, sources } of pages) {
    if (!sources || changedSet.has(page)) continue;
    const res = sources.map(globToRegExp);
    const matched = relevant.filter((file) => res.some((re) => re.test(file)));
    if (matched.length > 0) stale.push({ page, matched });
  }
  return { skipped: false, stale };
}
