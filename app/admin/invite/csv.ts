// Auto-detect the email column from CSV headers (case-insensitive)
export function detectEmailColumn(headers: string[]): number {
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].trim().toLowerCase();
    if (h.includes("email") || h.includes("e-mail") || h === "mail") {
      return i;
    }
  }
  return -1;
}

// Auto-detect a name column from CSV headers
export function detectNameColumn(headers: string[]): number {
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].trim().toLowerCase();
    if (h.includes("name")) {
      return i;
    }
  }
  return 0; // fallback to first column
}

// A file can list someone twice; the first row for an email wins.
export function uniqueByEmail<T extends { email: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.email)) return false;
    seen.add(row.email);
    return true;
  });
}

// The name column falls back to the first column, which can be the email column.
export function importCandidates(
  dataRows: string[][],
  nameIdx: number,
  emailIdx: number
): { name: string; email: string }[] {
  return uniqueByEmail(
    dataRows
      .map((row) => ({
        name: nameIdx === emailIdx ? "" : (row[nameIdx] || "").trim(),
        email: (row[emailIdx] || "").trim().toLowerCase(),
      }))
      .filter((r) => r.email && r.email.includes("@"))
  );
}

// Minimal CSV parser (no external dependency). A quote only opens at the start
// of a cell, so a stray one inside a cell can't swallow the rows after it.
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch !== '"') {
        current += ch;
      } else if (text[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = false;
      }
    } else if (ch === '"' && current.trim() === "") {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(current.trim());
      current = "";
    } else if (ch === "\n" || (ch === "\r" && text[i + 1] !== "\n")) {
      row.push(current.trim());
      rows.push(row);
      row = [];
      current = "";
    } else if (ch !== "\r") {
      current += ch;
    }
  }
  if (current.length > 0 || row.length > 0) {
    row.push(current.trim());
    rows.push(row);
  }

  return rows.filter((r) => r.length > 1 || r[0] !== "");
}
