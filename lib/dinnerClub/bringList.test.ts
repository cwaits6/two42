import { describe, expect, it } from "vitest";
import { BRING_OPTIONS, bringItem, suggestBringList } from "./bringList";

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
  });
});
