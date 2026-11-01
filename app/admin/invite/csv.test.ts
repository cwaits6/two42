import { describe, expect, it } from "vitest";
import { detectEmailColumn, detectNameColumn, parseCSV, uniqueByEmail } from "./csv";

describe("CSV import", () => {
  it("reads quoted cells and finds the email and name columns", () => {
    const [headers, row] = parseCSV('Full Name,E-mail\r\n"Lovelace, Ada",ada@example.test\n');
    expect(row).toEqual(["Lovelace, Ada", "ada@example.test"]);
    expect(detectEmailColumn(headers)).toBe(1);
    expect(detectNameColumn(headers)).toBe(0);
  });

  it("reports no email column", () => {
    expect(detectEmailColumn(["Name", "Phone"])).toBe(-1);
  });

  it("keeps the first row when a file lists an email twice", () => {
    const rows = uniqueByEmail([
      { name: "Ada", email: "ada@example.test" },
      { name: "Grace", email: "grace@example.test" },
      { name: "Ada L", email: "ada@example.test" },
    ]);
    expect(rows.map((r) => r.name)).toEqual(["Ada", "Grace"]);
  });
});
