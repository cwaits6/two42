import { describe, expect, it } from "vitest";
import { BRING_OPTIONS, bringItem, bringListFor, suggestBringList } from "./bringList";

describe("suggestBringList", () => {
  it("gives three guests three different things", () => {
    const list = suggestBringList({ guestPartyIds: ["c", "a", "b"], earlier: {}, dinnerIndex: 0 });
    expect(Object.keys(list).sort()).toEqual(["a", "b", "c"]);
    expect(new Set(Object.values(list)).size).toBe(3);
  });

  it("gives a party that brought Dessert last dinner something else", () => {
    for (let dinnerIndex = 0; dinnerIndex < 5; dinnerIndex++) {
      const list = suggestBringList({ guestPartyIds: ["a"], earlier: { a: ["Dessert"] }, dinnerIndex });
      expect(list.a).not.toBe("Dessert");
    }
  });

  it("has no party repeat an item before it has brought all five, over a season", () => {
    const guests = ["a", "b", "c"];
    const earlier: Record<string, string[]> = {};
    for (let dinnerIndex = 0; dinnerIndex < 5; dinnerIndex++) {
      const list = suggestBringList({ guestPartyIds: guests, earlier, dinnerIndex });
      expect(new Set(Object.values(list)).size).toBe(3);
      for (const id of guests) earlier[id] = [...(earlier[id] ?? []), list[id]];
    }
    for (const id of guests) expect(new Set(earlier[id])).toEqual(new Set(BRING_OPTIONS));
  });

  it("repeats an item across six guests, but never a party's own last one", () => {
    const guests = ["a", "b", "c", "d", "e", "f"];
    const earlier: Record<string, string[]> = {};
    for (let dinnerIndex = 0; dinnerIndex < 4; dinnerIndex++) {
      const list = suggestBringList({ guestPartyIds: guests, earlier, dinnerIndex });
      expect(new Set(Object.values(list)).size).toBe(5);
      for (const id of guests) {
        expect(list[id]).not.toBe(earlier[id]?.at(-1));
        earlier[id] = [...(earlier[id] ?? []), list[id]];
      }
    }
  });

  it("does not let something else a party brought block an option", () => {
    const list = suggestBringList({ guestPartyIds: ["a"], earlier: { a: ["Lemonade"] }, dinnerIndex: 0 });
    expect(list.a).toBe("Side");
  });
});

describe("bringItem", () => {
  it("trims and keeps 1 to 60 characters", () => {
    expect(bringItem("  Pie ")).toBe("Pie");
    expect(bringItem("   ")).toBeNull();
    expect(bringItem("x".repeat(60))).toBe("x".repeat(60));
    expect(bringItem("x".repeat(61))).toBeNull();
    expect(bringItem("🥧".repeat(60))).toBe("🥧".repeat(60));
  });
});

describe("bringListFor", () => {
  const dinner = { id: "d3", table_id: "T", season_date_id: "s3", starts_at: "2027-03-01T18:00:00Z", host_party_id: "h" };
  const season = {
    dates: [{ id: "s1" }, { id: "s2" }, { id: "s3" }, { id: "s4" }],
    dinners: [
      { id: "d1", starts_at: "2027-01-01T18:00:00Z" },
      { id: "d2", starts_at: "2027-02-01T18:00:00Z" },
      dinner,
      { id: "d4", starts_at: "2027-04-01T18:00:00Z" },
    ],
    seats: [
      { table_id: "T", party_id: "h", left_at: null },
      { table_id: "T", party_id: "a", left_at: null },
      { table_id: "T", party_id: "gone", left_at: "2027-02-15T00:00:00Z" },
      { table_id: "U", party_id: "b", left_at: null },
    ],
    contributions: [
      { dinner_id: "d4", party_id: "a", item: "Bread" },
      { dinner_id: "d2", party_id: "a", item: "Salad" },
      { dinner_id: "d3", party_id: "a", item: "Drinks" },
      { dinner_id: "d1", party_id: "a", item: "Dessert" },
    ],
  };

  it("lists the guests seated now, host left out, with their items here", () => {
    const list = bringListFor(dinner, season, (id) => `party ${id}`);
    expect(list.guests).toEqual([{ partyId: "a", names: "party a", item: "Drinks" }]);
    expect(list.dinnerIndex).toBe(2);
  });

  it("gives Suggest only items from strictly earlier dinners, oldest first", () => {
    expect(bringListFor(dinner, season, (id) => id).earlier).toEqual({ a: ["Dessert", "Salad"] });
  });
});
