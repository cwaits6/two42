import { parsePhoneNumberFromString, AsYouType } from "libphonenumber-js";

/**
 * Input sanitization for member directory fields.
 *
 * All functions are pure — they take a raw string and return the normalized
 * form. Pass the result straight into the database. Empty / whitespace-only
 * input returns null so we can cleanly clear optional fields.
 */

// -----------------------------------------------------------------------------
// Names
// -----------------------------------------------------------------------------

// Name particles that should stay lowercase when they appear in the middle of a
// name. At the start they are capitalized unless typed in lowercase before a
// later word typed with its capital. Intentionally conservative — we only
// handle the common western European patterns our members are likely to use.
const LOWERCASE_PARTICLES = new Set([
  "de", "del", "de la", "de las", "de los", "della", "der", "di", "du",
  "la", "las", "le", "los", "van", "van der", "van den", "von", "y",
]);

// Tokens that should stay fully uppercase (roman numerals, abbreviations).
const UPPERCASE_TOKENS = new Set([
  "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x",
]);

const isUpper = (c: string) => c !== c.toLowerCase();
const isLower = (c: string) => c !== c.toUpperCase();

/**
 * Upper-case the first character. Where its capital is longer than one letter
 * only the first is kept upper-case ("ß" → "Ss", "ﬁ" → "Fi"), so a second pass
 * leaves the word alone.
 */
function capitalize(word: string): string {
  const [first = "", ...rest] = word;
  const upper = first.toUpperCase();
  const [head = "", ...tail] = upper;
  return head + tail.join("").toLowerCase() + rest.join("");
}

/**
 * A word typed with deliberate inner capitals ("DeSantis", "McKay",
 * "O'Brien") rather than in one case or with Caps Lock on ("mARY",
 * "McDONALD"). A lowercase first letter alone is not taken as intent.
 */
function hasTypedCapitals(word: string): boolean {
  const chars = [...capitalize(word)];
  if (!isUpper(chars[0])) return false;
  if (!chars.some(isLower)) return false;
  if (!chars.slice(1).some(isUpper)) return false;
  return !chars.some((c, i) => i > 0 && isUpper(c) && isUpper(chars[i - 1]));
}

/**
 * Title-case a single word. Keeps capitals typed inside the word; a word typed
 * in one case gets Mc and O'/D' capitals and upper-case roman numerals.
 */
function titleCaseWord(word: string): string {
  if (!word) return word;
  if (word.includes("-")) return word.split("-").map(titleCaseWord).join("-");
  if (hasTypedCapitals(word)) return capitalize(word);

  const lower = word.toLowerCase();
  if (UPPERCASE_TOKENS.has(lower)) return lower.toUpperCase();

  if (lower.length > 2 && (lower.startsWith("o'") || lower.startsWith("d'"))) {
    return capitalize(lower.slice(0, 2)) + capitalize(lower.slice(2));
  }

  // "Mac" is left alone: Mack, Macy and Machado outnumber the MacDonalds,
  // who keep their capital by typing it.
  if (lower.startsWith("mc") && lower.length > 2) {
    return "Mc" + capitalize(lower.slice(2));
  }

  return capitalize(lower);
}

/**
 * Title-case a full name or name fragment. Collapses whitespace, handles
 * particles like "van der", preserves hyphens and apostrophes.
 */
export function titleCaseName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/\s+/g, " ");
  if (!trimmed) return null;

  const words = trimmed.split(" ");
  const cased = words.map((word, i) => {
    const lower = word.toLowerCase();
    return i > 0 && LOWERCASE_PARTICLES.has(lower) ? lower : titleCaseWord(word);
  });
  const first = words[0];
  // A leading particle typed in lowercase before a later word typed with its
  // capital ("van der Berg", "de la Cruz") is kept that way. The later word
  // must keep that shape once cased too, or a second pass would decide
  // differently ("de La O" saves as "De la O").
  const keepFirstLower =
    first === first.toLowerCase() &&
    LOWERCASE_PARTICLES.has(first) &&
    words.some((w, i) => i > 0 && writtenInCase(w) && writtenInCase(cased[i]));
  if (keepFirstLower) cased[0] = first;
  return cased.join(" ");
}

const writtenInCase = (word: string) =>
  isUpper([...word][0] ?? "") && [...word].some(isLower);

/**
 * Alias for titleCaseName — "john smith" → "John Smith".
 * Exported separately for callers that prefer this name.
 */
export const toTitleCase = titleCaseName;

// -----------------------------------------------------------------------------
// Phone numbers
// -----------------------------------------------------------------------------

/**
 * Parse a user-entered phone number into E.164 (`+15551234567`) for storage.
 * Assumes US as the default country — works for plain 10-digit and +1 formats.
 * Returns null if the input is empty or unparseable.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const parsed = parsePhoneNumberFromString(trimmed, "US");
  if (!parsed || !parsed.isValid()) return null;
  return parsed.format("E.164");
}

/**
 * Format an E.164 phone number for display: `+15551234567` → `(555) 123-4567`.
 * Falls back to the raw input if it can't be parsed.
 */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return "";
  const parsed = parsePhoneNumberFromString(e164);
  if (!parsed) return e164;
  // National format for US numbers, international for everything else.
  return parsed.country === "US"
    ? parsed.formatNational()
    : parsed.formatInternational();
}

/**
 * Live-format a phone number as the user types. Used in input `onChange`
 * handlers so the field reformats as they enter digits.
 */
export function formatPhoneAsYouType(raw: string): string {
  return new AsYouType("US").input(raw);
}

// -----------------------------------------------------------------------------
// Address
// -----------------------------------------------------------------------------

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

  const fullMatch = STATE_NAMES[trimmed.toLowerCase()];
  return fullMatch ?? null;
}

/**
 * Normalize a ZIP code. Accepts 5-digit or ZIP+4 (`12345` or `12345-6789`).
 * Strips whitespace and enforces the dash. Returns null for invalid input.
 */
export function normalizePostalCode(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 5) return digits;
  if (digits.length === 9) return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  return null;
}

// -----------------------------------------------------------------------------
// Email + plain text
// -----------------------------------------------------------------------------

export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  return trimmed || null;
}

/**
 * Trim and collapse internal whitespace. Use for freeform text fields like
 * bio, occupation, employer where no case enforcement applies.
 */
export function trimText(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/\s+/g, " ");
  return trimmed || null;
}
