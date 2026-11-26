import { describe, expect, it } from "vitest";
import {
  gradeFor,
  gradeLabel,
  childGradeLabel,
  graduationYearFor,
  parseGraduationYear,
  schoolYearEnd,
} from "@/lib/grade";

const day = (y: number, m: number, d: number) => new Date(y, m - 1, d);

describe("schoolYearEnd", () => {
  it("rolls over on 1 August", () => {
    expect(schoolYearEnd(day(2026, 7, 31))).toBe(2026);
    expect(schoolYearEnd(day(2026, 8, 1))).toBe(2027);
    expect(schoolYearEnd(day(2027, 1, 1))).toBe(2027);
  });
});

describe("gradeFor", () => {
  it("moves a child up a grade on 1 August with no edit", () => {
    expect(gradeFor(2036, day(2026, 7, 31))).toBe(2);
    expect(gradeFor(2036, day(2026, 8, 1))).toBe(3);
  });

  it("runs from kindergarten to 12th grade", () => {
    expect(gradeFor(2039, day(2026, 9, 1))).toBe(0);
    expect(gradeFor(2027, day(2026, 9, 1))).toBe(12);
  });

  it("has no grade before kindergarten, after graduating or without a year", () => {
    expect(gradeFor(2040, day(2026, 9, 1))).toBeNull();
    expect(gradeFor(2026, day(2026, 9, 1))).toBeNull();
    expect(gradeFor(null, day(2026, 9, 1))).toBeNull();
  });

  it("round-trips with graduationYearFor", () => {
    const today = day(2026, 11, 26);
    for (let grade = 0; grade <= 12; grade++) {
      expect(gradeFor(graduationYearFor(grade, today), today)).toBe(grade);
    }
  });
});

describe("gradeLabel", () => {
  it("names each grade", () => {
    expect(gradeLabel(0)).toBe("Kindergarten");
    expect(gradeLabel(1)).toBe("1st grade");
    expect(gradeLabel(2)).toBe("2nd grade");
    expect(gradeLabel(3)).toBe("3rd grade");
    expect(gradeLabel(4)).toBe("4th grade");
    expect(gradeLabel(11)).toBe("11th grade");
    expect(gradeLabel(12)).toBe("12th grade");
  });
});

describe("childGradeLabel", () => {
  const today = day(2026, 11, 26);

  it("labels a child's grade", () => {
    expect(childGradeLabel({ relationship: "child", graduation_year: 2036 }, today)).toBe("3rd grade");
  });

  it("shows nothing for anyone but a child, or without a grade in range", () => {
    expect(childGradeLabel({ relationship: "spouse", graduation_year: 2036 }, today)).toBeNull();
    expect(childGradeLabel({ relationship: "child", graduation_year: null }, today)).toBeNull();
    expect(childGradeLabel({ relationship: "child", graduation_year: 2045 }, today)).toBeNull();
  });
});

describe("parseGraduationYear", () => {
  it("accepts a whole year in range and clears on null or empty", () => {
    expect(parseGraduationYear(2035)).toBe(2035);
    expect(parseGraduationYear("2035")).toBe(2035);
    expect(parseGraduationYear(null)).toBeNull();
    expect(parseGraduationYear("")).toBeNull();
  });

  it("refuses anything else", () => {
    expect(parseGraduationYear(1999)).toBeUndefined();
    expect(parseGraduationYear(2101)).toBeUndefined();
    expect(parseGraduationYear(2035.5)).toBeUndefined();
    expect(parseGraduationYear("soon")).toBeUndefined();
    expect(parseGraduationYear(true)).toBeUndefined();
  });
});
