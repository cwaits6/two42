import { findSourceProblems, readPages, trackedFiles } from './docs-sources.mjs';

const problems = findSourceProblems(readPages(), trackedFiles());
for (const { page, message } of problems) {
  console.error(`::error file=${page}::${page}: ${message}`);
}
if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s) with the pages' sources lists.`);
  process.exit(1);
}
console.log('Every page lists sources, and every glob matches a tracked file.');
