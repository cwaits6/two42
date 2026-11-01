import { describe, expect, it } from "vitest";
import {
  detectEmailColumn,
  detectNameColumn,
  importCandidates,
  parseCSV,
  uniqueByEmail,
} from "./csv";

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

  it("keeps a quoted line break inside one row", () => {
    const rows = parseCSV('Name,Notes,Email\n\nAda,"Met at\r\nconference",ada@example.test\nGrace,,grace@example.test');
    expect(rows).toEqual([
      ["Name", "Notes", "Email"],
      ["Ada", "Met at\r\nconference", "ada@example.test"],
      ["Grace", "", "grace@example.test"],
    ]);
  });

  it("reads doubled quotes and treats a stray quote as text without losing later rows", () => {
    const rows = parseCSV('"Ada ""Countess"" L",ada@example.test\nGrace 5" H,grace@example.test\nAlan,alan@example.test\n');
    expect(rows).toEqual([
      ['Ada "Countess" L', "ada@example.test"],
      ['Grace 5" H', "grace@example.test"],
      ["Alan", "alan@example.test"],
    ]);
  });

  it("leaves the name empty when the name column is the email column", () => {
    const [headers, ...data] = parseCSV("Email\nAda@example.test\n");
    const nameIdx = detectNameColumn(headers);
    const emailIdx = detectEmailColumn(headers);
    expect(importCandidates(data, nameIdx, emailIdx)).toEqual([
      { name: "", email: "ada@example.test" },
    ]);
  });
});
