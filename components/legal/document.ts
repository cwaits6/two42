/**
 * A paragraph is a string; a bulleted list is an array of strings. Links are
 * written `[text](href)` inside either.
 */
export type LegalBlock = string | readonly string[];

export interface LegalSection {
  heading: string;
  blocks: readonly LegalBlock[];
}

export interface LegalDocument {
  title: string;
  summary: string;
  /** YYYY-MM-DD. The one place the date lives. */
  lastUpdated: string;
  sections: readonly LegalSection[];
}

export type InlinePart = { text: string } | { text: string; href: string };

const LINK = /\[([^\]]+)\]\(([^)\s]+)\)/g;

export function inlineParts(text: string): InlinePart[] {
  const parts: InlinePart[] = [];
  let last = 0;
  for (const match of text.matchAll(LINK)) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index) });
    parts.push({ text: match[1], href: match[2] });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Read as written, never through a time zone, so the shown day is the day typed. */
export function formatLastUpdated(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const month = match ? MONTHS[Number(match[2]) - 1] : undefined;
  if (!match || !month) throw new Error(`lastUpdated must be YYYY-MM-DD, got "${date}"`);
  return `${month} ${Number(match[3])}, ${match[1]}`;
}

export function sectionId(heading: string): string {
  return heading.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
