/**
 * RFC 4180 CSV codec plus the OWASP spreadsheet formula-injection guard
 * (CWA-40). Pure string→string functions with zero dependencies — no IO, no
 * framework imports — so vitest can exercise every hazard in a plain node
 * environment. The higher-level column contract lives in lib/members/format.ts;
 * this module knows nothing about members, only about cells.
 */

/**
 * First characters a spreadsheet interprets as a formula trigger (OWASP CSV
 * Injection). Cells starting with one of these are prefixed with a single
 * apostrophe on export; unguardCell strips exactly that prefix on import.
 */
export const FORMULA_TRIGGERS: ReadonlySet<string> = new Set([
  "=",
  "+",
  "-",
  "@",
  "\t",
  "\r",
]);

const NEEDS_QUOTING = /[",\r\n]/;

/**
 * Parse RFC 4180 CSV text into rows of cells. Strips a single leading BOM.
 * Handles doubled-quote escapes, embedded commas and newlines inside quoted
 * cells, CRLF and LF line endings, and a trailing newline (which does NOT
 * produce a final empty row). Cells are returned verbatim — no trimming, no
 * unguarding; those are deliberate decisions the format layer makes.
 */
export function parseCsv(text: string): string[][] {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let i = 0;

  while (i < input.length) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      row.push(cell);
      cell = "";
      i += 1;
      continue;
    }
    if (ch === "\r" && input[i + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i += 2;
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i += 1;
      continue;
    }
    cell += ch;
    i += 1;
  }

  // A trailing newline leaves nothing pending — flushing unconditionally here
  // would fabricate a phantom empty row at the end of every well-formed file.
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/**
 * Serialize rows to RFC 4180 CSV joined with CRLF (no trailing newline). A
 * cell is quoted iff it contains a quote, comma, CR, or LF — or starts with
 * the guard apostrophe, so a guarded cell survives spreadsheet round trips
 * visibly intact. Inner quotes are doubled.
 */
export function serializeCsv(rows: string[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) =>
          NEEDS_QUOTING.test(cell) || cell.startsWith("'")
            ? `"${cell.replace(/"/g, '""')}"`
            : cell
        )
        .join(",")
    )
    .join("\r\n");
}

/**
 * Prefix a single apostrophe when the first character is a formula trigger.
 * Applied to every cell on export so a roster value like `=HYPERLINK(...)`
 * renders as inert text when the admin opens the file in a spreadsheet.
 */
export function guardCell(value: string): string {
  return value.length > 0 && FORMULA_TRIGGERS.has(value[0])
    ? `'${value}`
    : value;
}

/**
 * The exact inverse of guardCell: strip one leading apostrophe iff the next
 * character is a formula trigger. Anything else is untouched. Known and
 * accepted asymmetry: a value that legitimately starts with `'` followed by a
 * trigger (e.g. `'=x`) is indistinguishable from a guarded `=x` and loses its
 * apostrophe — pinned by test rather than "fixed" with an escaping scheme no
 * spreadsheet would understand.
 */
export function unguardCell(value: string): string {
  return value.length > 1 && value[0] === "'" && FORMULA_TRIGGERS.has(value[1])
    ? value.slice(1)
    : value;
}
