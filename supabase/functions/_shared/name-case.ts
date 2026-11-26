// How every form saves a person's name. The church records copy shares it, so a
// copied name is already in the shape a member's next save would give it.

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
export function titleCaseWord(word: string): string {
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

export const MAX_NAME_LENGTH = 100;
export const MAX_TITLE_LENGTH = 40;
export const MAX_SUFFIX_LENGTH = 20;

/**
 * Lowercased, accents and punctuation removed, so "José O'Brien" and "jose obrien" agree.
 * Only Latin accents fold: in scripts such as Devanagari a vowel sign tells two names apart.
 */
export function normalizeName(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]/gu, "");
}
