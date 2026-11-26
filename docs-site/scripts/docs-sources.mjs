import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { posix } from 'node:path';

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
  return new RegExp(`^${pattern}$`);
}

export function isIndexPage(page) {
  return posix.basename(page) === 'index.mdx';
}

// Reads the `sources` block list from a page's frontmatter. The format is
// kept to a block list so this needs no YAML dependency; anything else is
// reported rather than read as no sources.
export function parseSources(text) {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!frontmatter) return { sources: null };
  const lines = frontmatter[1].split(/\r?\n/);
  const start = lines.findIndex((line) => /^sources\s*:/.test(line));
  if (start === -1) return { sources: null };
  if (!/^sources\s*:\s*$/.test(lines[start])) {
    return { sources: null, error: 'write sources as a block list, one "- glob" per line' };
  }
  const sources = [];
  for (const line of lines.slice(start + 1)) {
    const item = /^\s+-\s+(.+?)\s*$/.exec(line);
    if (!item) break;
    sources.push(item[1].replace(/^(["'])(.*)\1$/, '$2'));
  }
  return { sources };
}

export function readPages(root = REPO_ROOT) {
  const dir = posix.join(root.replaceAll('\\', '/'), CONTENT_DIR);
  return readdirSync(dir, { recursive: true })
    .map((file) => file.replaceAll('\\', '/'))
    .filter((file) => file.endsWith('.mdx'))
    .sort()
    .map((file) => {
      const page = `${CONTENT_DIR}/${file}`;
      return { page, ...parseSources(readFileSync(posix.join(dir, file), 'utf8')) };
    });
}

export function trackedFiles(root = REPO_ROOT) {
  return execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
}

// Every problem with the pages' sources lists: a page with none, a list that
// cannot be read, or a glob that matches no tracked file.
export function findSourceProblems(pages, files) {
  const problems = [];
  for (const { page, sources, error } of pages) {
    if (error) {
      problems.push({ page, message: error });
    } else if (!sources || sources.length === 0) {
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
