// How every form saves a household address. The church records copy shares it,
// so a copied address is already in the shape a member's next save would give it.
import { titleCaseName, titleCaseWord } from "./name-case.ts";

// Common street suffix and directional abbreviations that should stay
// uppercase (NE, SW) or title-cased standardly (St, Ave).
const STREET_UPPERCASE = new Set([
  "ne", "nw", "se", "sw", "n", "s", "e", "w",
  "po", "us", "usa",
]);

/**
 * Title-case a street address while uppercasing directional abbreviations
 * (NE, NW) and leaving the digits in "123 Main St" alone.
 */
export function titleCaseStreet(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/\s+/g, " ");
  if (!trimmed) return null;

  return trimmed
    .split(" ")
    .map((word) => {
      // Leave pure numbers and alphanumeric unit designators alone.
      if (/^\d+[a-z]?$/i.test(word)) return word;
      // Directional / abbreviation → uppercase
      const lower = word.toLowerCase().replace(/[.,]/g, "");
      if (STREET_UPPERCASE.has(lower)) return word.toUpperCase();
      return titleCaseWord(word);
    })
    .join(" ");
}

/**
 * Title-case a city name — same rules as a person's name.
 */
export function titleCaseCity(raw: string | null | undefined): string | null {
  return titleCaseName(raw);
}

/**
 * Normalize a US state to the 2-letter uppercase abbreviation. Accepts either
 * the abbreviation ("tx", "TX") or the full state name ("Texas"). Returns null
 * if the input can't be resolved.
 */
const STATE_NAMES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR",
  california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE",
  florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID",
  illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS",
  kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS",
  missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM",
  "new york": "NY", "north carolina": "NC", "north dakota": "ND",
  ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA",
  "rhode island": "RI", "south carolina": "SC", "south dakota": "SD",
  tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV",
  wisconsin: "WI", wyoming: "WY", "district of columbia": "DC",
};

const VALID_STATE_ABBRS = new Set(Object.values(STATE_NAMES));

export function normalizeState(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const upper = trimmed.toUpperCase();
  if (upper.length === 2 && VALID_STATE_ABBRS.has(upper)) return upper;

  const key = trimmed.toLowerCase();
  return Object.hasOwn(STATE_NAMES, key) ? STATE_NAMES[key] : null;
}

/**
 * Normalize a ZIP code. Accepts 5-digit or ZIP+4 (`12345` or `12345-6789`).
 * Strips whitespace and enforces the dash. Returns null for invalid input.
 */
export function normalizePostalCode(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;
  const match = /^(\d{5})(?:-?(\d{4}))?$/.exec(raw.replace(/\s/g, ""));
  if (!match) return null;
  return match[2] ? `${match[1]}-${match[2]}` : match[1];
}
