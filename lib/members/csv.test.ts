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

describe("parseCsv", () => {
  it("parses a quoted field containing a comma", () => {
    expect(parseCsv('a,"b,c",d')).toEqual([["a", "b,c", "d"]]);
  });

  it("parses a quoted field containing an embedded newline", () => {
    expect(parseCsv('a,"line1\nline2",b')).toEqual([["a", "line1\nline2", "b"]]);
  });

  it("parses a quoted field containing an embedded CRLF", () => {
    expect(parseCsv('a,"x\r\ny"')).toEqual([["a", "x\r\ny"]]);
  });

  it("unescapes doubled quotes inside a quoted field", () => {
    expect(parseCsv('"say ""hi""",b')).toEqual([['say "hi"', "b"]]);
  });

  it("treats CRLF and LF row separators identically", () => {
    expect(parseCsv("a,b\r\nc,d")).toEqual(parseCsv("a,b\nc,d"));
  });

  it("handles a lone CR as a row separator", () => {
    expect(parseCsv("a\rb")).toEqual([["a"], ["b"]]);
  });

  it("strips a single leading BOM", () => {
    expect(parseCsv("﻿a,b")).toEqual([["a", "b"]]);
  });

  it("does not yield a phantom row for a trailing newline", () => {
    expect(parseCsv("a,b\r\n")).toEqual([["a", "b"]]);
    expect(parseCsv("a,b\n")).toEqual([["a", "b"]]);
  });

  it("preserves an empty trailing cell", () => {
    expect(parseCsv("a,b,\n")).toEqual([["a", "b", ""]]);
    expect(parseCsv("a,b,")).toEqual([["a", "b", ""]]);
  });

  it("returns no rows for empty input", () => {
    expect(parseCsv("")).toEqual([]);
  });

  it("returns no rows for a BOM-only file", () => {
    expect(parseCsv("﻿")).toEqual([]);
  });

  it("does not trim cell whitespace (trimming is the format layer's job)", () => {
    expect(parseCsv(" a , b ")).toEqual([[" a ", " b "]]);
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
    expect(parseCsv(serializeCsv(rows))).toEqual(rows);
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
