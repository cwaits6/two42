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

/** Read as written, never through a time zone, so the shown day is the day typed. */
export function formatLastUpdated(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  // The round trip refuses a day the month does not have, which Date would roll over.
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== date) {
    throw new Error(`lastUpdated must be YYYY-MM-DD, got "${date}"`);
  }
  return d.toLocaleDateString("en-US", { dateStyle: "long", timeZone: "UTC" });
}

export function sectionId(heading: string): string {
  return heading.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
