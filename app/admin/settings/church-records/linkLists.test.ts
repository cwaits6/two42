import { describe, expect, it } from "vitest";
import { batches, page, people, search, sections, type SuggestionRow } from "./linkLists";

function suggestion(over: Partial<SuggestionRow>): SuggestionRow {
  return {
    profileId: "p1",
    name: "Ann Lee",
    personId: "1",
    personName: "Ann Lee",
    personUrl: "https://rock.example.org/Person/1",
    matched: { email: true, birthday: false },
    confirmableInBulk: true,
    ...over,
  };
}

describe("sections", () => {
  it("puts bulk-confirmable suggestions in Ready, groups the rest by profile, and keeps no-match names", () => {
    const result = sections({
      linked: [],
      suggestions: [
        suggestion({ profileId: "p2", name: "Zoe Ray", personId: "2" }),
        suggestion({ profileId: "p1", name: "Ann Lee", personId: "1" }),
        suggestion({ profileId: "p3", name: "Tom Obrien", personId: "3", confirmableInBulk: false }),
        suggestion({ profileId: "p3", name: "Tom Obrien", personId: "4", confirmableInBulk: false }),
        suggestion({ profileId: "p4", name: "Bo Diaz", personId: "5", confirmableInBulk: false }),
      ],
      unmatched: [
        { profileId: "p6", name: "Yan Wu" },
        { profileId: "p5", name: "Al Ng" },
      ],
    });
    expect(result.ready.map((r) => r.name)).toEqual(["Ann Lee", "Zoe Ray"]);
    expect(result.checkFirst.map((r) => [r.name, r.candidates.length])).toEqual([
      ["Bo Diaz", 1],
      ["Tom Obrien", 2],
    ]);
    expect(result.noMatch.map((r) => r.name)).toEqual(["Al Ng", "Yan Wu"]);
  });
});

describe("search", () => {
  const rows = [{ name: "José Ramírez" }, { name: "Ann Lee" }, { name: "Lee Ann Park" }];

  it("matches every word of the search anywhere in the name, ignoring case and accents", () => {
    expect(search(rows, "jose")).toEqual([{ name: "José Ramírez" }]);
    expect(search(rows, "ann lee").map((r) => r.name)).toEqual(["Ann Lee", "Lee Ann Park"]);
    expect(search(rows, "  ")).toHaveLength(3);
  });
});

describe("page", () => {
  const rows = Array.from({ length: 60 }, (_, i) => i);

  it("shows 25 at a time and keeps the page in range", () => {
    expect(page(rows, 0)).toMatchObject({ index: 0, count: 3 });
    expect(page(rows, 2).rows).toEqual(rows.slice(50));
    expect(page(rows, 9).index).toBe(2);
    expect(page([], 0)).toEqual({ rows: [], index: 0, count: 1 });
  });
});

describe("batches", () => {
  it("never sends more than the server accepts in one request", () => {
    const sizes = batches(Array.from({ length: 250 }, (_, i) => i)).map((b) => b.length);
    expect(sizes).toEqual([100, 100, 50]);
  });
});

describe("people", () => {
  it("counts with thousands separators", () => {
    expect(people(1)).toBe("1 person");
    expect(people(1184)).toBe("1,184 people");
  });
});
