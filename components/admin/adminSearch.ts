function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/**
 * Whether every word of the query appears in one of the fields, ignoring case
 * and accents, so "ana perez" finds "Ana" in the name and "Pérez" in another
 * field. A blank query matches everything.
 */
export function matchesSearch(query: string, fields: (string | null | undefined)[]): boolean {
  const haystack = fields.filter(Boolean).map((field) => fold(field as string));
  return fold(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.some((field) => field.includes(word)));
}
