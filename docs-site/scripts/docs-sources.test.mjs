import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  findSourceProblems,
  findStalePages,
  globToRegExp,
  parseSources,
  readPages,
  trackedFiles,
} from './docs-sources.mjs';

const CALENDAR = 'docs-site/content/docs/use/calendar.mdx';
const EVENT_LIST = 'components/events/EventListView.tsx';

describe('globToRegExp', () => {
  test('treats brackets and parentheses as literal', () => {
    assert.ok(globToRegExp('app/g/[groupId]/calendar/**').test('app/g/[groupId]/calendar/page.tsx'));
    assert.ok(!globToRegExp('app/g/[groupId]/calendar/**').test('app/g/g/calendar/page.tsx'));
    assert.ok(globToRegExp('app/(auth)/login/**').test('app/(auth)/login/page.tsx'));
  });

  test('keeps * inside one segment and lets ** cross segments', () => {
    assert.ok(globToRegExp('lib/*.ts').test('lib/prayer.ts'));
    assert.ok(!globToRegExp('lib/*.ts').test('lib/prayer/visibility.ts'));
    assert.ok(globToRegExp('lib/**/*.ts').test('lib/prayer.ts'));
    assert.ok(globToRegExp('lib/**/*.ts').test('lib/prayer/visibility.ts'));
    assert.ok(!globToRegExp('components/events/**').test('components/eventsX/a.tsx'));
  });

  test('names one file when it has no wildcard', () => {
    assert.ok(globToRegExp('lib/roles.ts').test('lib/roles.ts'));
    assert.ok(!globToRegExp('lib/roles.ts').test('lib/roles.test.ts'));
  });
});

describe('parseSources', () => {
  test('reads a block list, quoted or not', () => {
    const text = '---\ntitle: T\nsources:\n  - "app/a/**"\n  - lib/b.ts\ndescription: D\n---\nBody';
    assert.deepEqual(parseSources(text), { sources: ['app/a/**', 'lib/b.ts'] });
  });

  test('reports a flow list instead of reading it as none', () => {
    const { sources, error } = parseSources('---\nsources: ["app/a/**"]\n---\n');
    assert.equal(sources, null);
    assert.match(error, /block list/);
  });

  test('returns null when the page lists no sources', () => {
    assert.deepEqual(parseSources('---\ntitle: T\n---\n'), { sources: null });
  });
});

describe('findSourceProblems', () => {
  const files = ['components/events/EventListView.tsx', 'lib/roles.ts'];

  test('names the page and the glob that matches no tracked file', () => {
    const pages = [{ page: CALENDAR, sources: ['components/events/**', 'components/calendr/**'] }];
    assert.deepEqual(findSourceProblems(pages, files), [
      { page: CALENDAR, message: 'glob matches no tracked file: components/calendr/**' },
    ]);
  });

  test('requires sources on every page except index pages', () => {
    const pages = [
      { page: 'docs-site/content/docs/use/index.mdx', sources: null },
      { page: CALENDAR, sources: null },
    ];
    assert.deepEqual(findSourceProblems(pages, files), [{ page: CALENDAR, message: 'has no sources list' }]);
  });
});

describe('findStalePages', () => {
  const pages = [{ page: CALENDAR, sources: ['components/events/**'] }];

  test('fails a listed path changed without its page, naming the page and the path', () => {
    assert.deepEqual(findStalePages(pages, [EVENT_LIST, 'lib/roles.ts']), {
      skipped: false,
      stale: [{ page: CALENDAR, matched: [EVENT_LIST] }],
    });
  });

  test('passes once the page changes too', () => {
    assert.deepEqual(findStalePages(pages, [EVENT_LIST, CALENDAR]).stale, []);
  });

  test('passes with the docs-not-needed label', () => {
    assert.deepEqual(findStalePages(pages, [EVENT_LIST], ['ci', 'docs-not-needed']), {
      skipped: true,
      stale: [],
    });
  });

  test('ignores test and snapshot files', () => {
    const changed = ['components/events/EventListView.test.ts', 'components/events/__snapshots__/a.snap'];
    assert.deepEqual(findStalePages(pages, changed).stale, []);
  });
});

// The same cases against the real pages, so a sources list that drifts away
// from the acceptance examples fails here.
describe('the docs pages', () => {
  const realPages = readPages();

  const files = trackedFiles();

  test('every page lists sources that match tracked files', () => {
    assert.deepEqual(findSourceProblems(realPages, files), []);
  });

  test('a change to the event list without the calendar page names the calendar page', () => {
    const { stale } = findStalePages(realPages, [EVENT_LIST]);
    assert.ok(stale.some(({ page, matched }) => page === CALENDAR && matched.includes(EVENT_LIST)));
  });

  test('the same change passes with the docs-not-needed label', () => {
    assert.equal(findStalePages(realPages, [EVENT_LIST], ['docs-not-needed']).stale.length, 0);
  });

  test('a change only under docs-site passes', () => {
    const changed = ['docs-site/app/global.css', 'docs-site/README.md', 'docs-site/scripts/check-links.mjs'];
    assert.deepEqual(findStalePages(realPages, changed).stale, []);
  });

  test('a change only to paths no page lists passes', () => {
    const changed = ['CHANGELOG.md', 'e2e/README.md', 'lib/log/index.ts', 'supabase/tests/schema_tenancy_lint.sql'];
    assert.deepEqual(findStalePages(realPages, changed).stale, []);
  });

  test('a dependency-only change passes', () => {
    const changed = [
      'package.json',
      'package-lock.json',
      'docs-site/package.json',
      'docs-site/package-lock.json',
      'deno.lock',
      ...files.filter((file) => file.startsWith('.github/workflows/')),
    ];
    assert.deepEqual(findStalePages(realPages, changed).stale, []);
  });
});
