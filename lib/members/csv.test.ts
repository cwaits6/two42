// Unit tests for the RFC 4180 codec and formula-injection guard (CWA-40).
// Pure units: parseCsv/serializeCsv/guardCell/unguardCell take strings to
// strings — no network, no database, no request context.

import { describe, expect, it } from "vitest";
import {
  guardCell,
  parseCsv,
  serializeCsv,
  unguardCell,
} from "@/lib/members/csv";

/** parseCsv's rows, for the cases that are not about the error channel. */
const rowsOf = (text: string): string[][] => parseCsv(text).rows;

describe("parseCsv", () => {
  it("parses a quoted field containing a comma", () => {
    expect(rowsOf('a,"b,c",d')).toEqual([["a", "b,c", "d"]]);
  });

  it("parses a quoted field containing an embedded newline", () => {
    expect(rowsOf('a,"line1\nline2",b')).toEqual([["a", "line1\nline2", "b"]]);
  });

  it("parses a quoted field containing an embedded CRLF", () => {
    expect(rowsOf('a,"x\r\ny"')).toEqual([["a", "x\r\ny"]]);
  });

  it("unescapes doubled quotes inside a quoted field", () => {
    expect(rowsOf('"say ""hi""",b')).toEqual([['say "hi"', "b"]]);
  });

  it("treats CRLF and LF row separators identically", () => {
    expect(rowsOf("a,b\r\nc,d")).toEqual(rowsOf("a,b\nc,d"));
  });

  it("handles a lone CR as a row separator", () => {
    expect(rowsOf("a\rb")).toEqual([["a"], ["b"]]);
  });

  it("strips a single leading BOM", () => {
    expect(rowsOf("﻿a,b")).toEqual([["a", "b"]]);
  });

  it("does not yield a phantom row for a trailing newline", () => {
    expect(rowsOf("a,b\r\n")).toEqual([["a", "b"]]);
    expect(rowsOf("a,b\n")).toEqual([["a", "b"]]);
  });

  it("preserves an empty trailing cell", () => {
    expect(rowsOf("a,b,\n")).toEqual([["a", "b", ""]]);
    expect(rowsOf("a,b,")).toEqual([["a", "b", ""]]);
  });

  it("returns no rows for empty input", () => {
    expect(rowsOf("")).toEqual([]);
  });

  it("returns no rows for a BOM-only file", () => {
    expect(rowsOf("﻿")).toEqual([]);
  });

  it("does not trim cell whitespace (trimming is the format layer's job)", () => {
    expect(rowsOf(" a , b ")).toEqual([[" a ", " b "]]);
  });

  it("reports no error for well-formed input", () => {
    expect(parseCsv('a,"b,c"\r\nd,e').unterminatedQuoteLine).toBeUndefined();
    expect(parseCsv("").unterminatedQuoteLine).toBeUndefined();
  });

  it("reports an unterminated quote instead of swallowing the rest of the file", () => {
    // The hazard this exists for: one stray `"` on line 2 absorbs every
    // remaining line into a single cell, and the truncated result parses as a
    // well-formed short row — a 3,000-row roster importing as one row and
    // reporting success. Without the error channel there is nothing to see.
    const result = parseCsv(
      [
        "first_name,last_name,email,has_login",
        'Ada,"Love,lace,ada@x.com,true',
        "Bob,Smith,bob@x.com,true",
        "Cy,Jones,cy@x.com,true",
      ].join("\r\n")
    );
    expect(result.unterminatedQuoteLine).toBe(2);
    // The truncated rows are still returned, and are still wrong — which is
    // precisely why the caller must abort on the flag rather than use them.
    expect(result.rows).toHaveLength(2);
  });

  it("reports the line the quote was OPENED on, not the last line", () => {
    const result = parseCsv('a,b\r\nc,d\r\ne,"f\r\ng\r\nh');
    expect(result.unterminatedQuoteLine).toBe(3);
  });

  it("counts lines inside a terminated quoted cell so the reported line is physical", () => {
    const result = parseCsv('a,"multi\r\nline\r\ncell"\r\nb,"oops');
    expect(result.unterminatedQuoteLine).toBe(4);
  });
});

describe("guardCell", () => {
  it.each(["=", "+", "-", "@", "\t", "\r"])(
    "prefixes an apostrophe when the cell starts with %j",
    (trigger) => {
      expect(guardCell(`${trigger}rest`)).toBe(`'${trigger}rest`);
    }
  );

  it("leaves ordinary values untouched", () => {
    expect(guardCell("hello")).toBe("hello");
    expect(guardCell("")).toBe("");
    expect(guardCell("a=b")).toBe("a=b");
  });
});

describe("unguardCell", () => {
  it("is the exact inverse of guardCell for adversarial values", () => {
    const values = [
      "=1+1",
      "+15551234567",
      "-5",
      "@handle",
      "\tindented",
      "\rcarriage",
      "plain",
      "",
      "'quoted but not a trigger",
      "=HYPERLINK(\"http://evil\",\"click\")",
      "= leading equals with space",
      "O'Brien",
    ];
    for (const value of values) {
      expect(unguardCell(guardCell(value))).toBe(value);
    }
  });

  it("leaves an apostrophe before a non-trigger character alone", () => {
    expect(unguardCell("'hello")).toBe("'hello");
  });

  it("mangles a legitimate leading apostrophe-plus-trigger (documented loss)", () => {
    // `'=x` cannot be distinguished from a guarded `=x`. The documented
    // behavior is that the apostrophe is stripped — pinned here so a future
    // "fix" has to confront the round-trip consequences explicitly.
    expect(guardCell("'=x")).toBe("'=x");
    expect(unguardCell("'=x")).toBe("=x");
  });
});

describe("serializeCsv / parseCsv round-trip", () => {
  it("round-trips a fixture with every hazard in one table", () => {
    const rows = [
      ["plain", "with,comma", 'with"quote', "with\nnewline"],
      ["with\r\ncrlf", "'=guarded", "", "  padded  "],
      ["=formula", "trailing", "", ""],
    ];
    expect(rowsOf(serializeCsv(rows))).toEqual(rows);
  });

  it("quotes only cells that need it", () => {
    expect(serializeCsv([["a", "b,c", 'd"e']])).toBe('a,"b,c","d""e"');
  });

  it("quotes a guard-prefixed cell so the apostrophe survives visibly", () => {
    expect(serializeCsv([["'=x"]])).toBe("\"'=x\"");
  });

  it("joins rows with CRLF and emits no trailing newline", () => {
    expect(serializeCsv([["a"], ["b"]])).toBe("a\r\nb");
  });
});
