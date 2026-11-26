import { readFileSync } from 'node:fs';
import { SKIP_LABEL, findStalePages, readPages } from './docs-sources.mjs';

// Usage: PR_LABELS='["label", ...]' node check-freshness.mjs <changed-files.txt>
const [changedList] = process.argv.slice(2);
if (!changedList) {
  console.error('Usage: node check-freshness.mjs <file listing the changed paths>');
  process.exit(2);
}
const changed = readFileSync(changedList, 'utf8').split('\n').filter(Boolean);
const labels = JSON.parse(process.env.PR_LABELS || '[]');

const { skipped, stale } = findStalePages(readPages(), changed, labels);
if (skipped) {
  console.log(`Skipped: the pull request carries the ${SKIP_LABEL} label.`);
  process.exit(0);
}
if (stale.length === 0) {
  console.log('No docs page lists a changed path without being updated too.');
  process.exit(0);
}
for (const { page, matched } of stale) {
  console.error(`::error file=${page}::Check ${page}: paths it lists changed`);
  console.error(`${page}\n${matched.map((file) => `  ${file}`).join('\n')}`);
}
console.error(
  `\nUpdate each page above in this pull request, using the app's own copy.` +
    ` If the change is one nobody can see, add the ${SKIP_LABEL} label instead.`,
);
process.exit(1);
