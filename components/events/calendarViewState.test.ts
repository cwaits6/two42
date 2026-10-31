import { describe, expect, it } from "vitest";
import {
  CALENDAR_VIEWS,
  calendarViewReducer,
  initialCalendarViewState,
  shownView,
} from "./calendarViewState";

const GROUPS = ["a", "b", "c"];

describe("calendarViewReducer", () => {
  it("offers Month, Week and List in that order", () => {
    expect(CALENDAR_VIEWS.map((v) => v.label)).toEqual(["Month", "Week", "List"]);
  });

  it("opens in List on a phone and in Month wider", () => {
    const state = initialCalendarViewState(GROUPS);
    expect(shownView(state, true)).toBe("list");
    expect(shownView(state, false)).toBe("month");
  });

  it("keeps the member's chosen view at any width", () => {
    const state = calendarViewReducer(initialCalendarViewState(GROUPS), { type: "setView", view: "month" });
    expect(shownView(state, true)).toBe("month");
    expect(shownView(calendarViewReducer(state, { type: "setView", view: "list" }), false)).toBe("list");
  });

  it("shows every group at first", () => {
    expect([...initialCalendarViewState(GROUPS).visibleGroupIds]).toEqual(GROUPS);
  });

  it("keeps the Showing selection when switching between Month and Week", () => {
    let state = initialCalendarViewState(GROUPS);
    state = calendarViewReducer(state, { type: "toggleGroup", id: "b" });
    expect([...state.visibleGroupIds]).toEqual(["a", "c"]);

    state = calendarViewReducer(state, { type: "setView", view: "week" });
    expect(state.chosenView).toBe("week");
    expect([...state.visibleGroupIds]).toEqual(["a", "c"]);

    state = calendarViewReducer(state, { type: "toggleGroup", id: "a" });
    state = calendarViewReducer(state, { type: "setView", view: "month" });
    expect(state.chosenView).toBe("month");
    expect([...state.visibleGroupIds]).toEqual(["c"]);

    state = calendarViewReducer(state, { type: "setView", view: "list" });
    expect([...state.visibleGroupIds]).toEqual(["c"]);
  });

  it("toggles a hidden group back on and restores everything with Show all", () => {
    let state = initialCalendarViewState(GROUPS);
    state = calendarViewReducer(state, { type: "toggleGroup", id: "c" });
    state = calendarViewReducer(state, { type: "toggleGroup", id: "c" });
    expect([...state.visibleGroupIds]).toEqual(GROUPS);

    state = calendarViewReducer(state, { type: "toggleGroup", id: "a" });
    state = calendarViewReducer(state, { type: "toggleGroup", id: "b" });
    state = calendarViewReducer(state, { type: "showAll" });
    expect([...state.visibleGroupIds]).toEqual(GROUPS);
  });

  it("leaves the previous state untouched", () => {
    const before = initialCalendarViewState(GROUPS);
    calendarViewReducer(before, { type: "toggleGroup", id: "a" });
    expect([...before.visibleGroupIds]).toEqual(GROUPS);
  });
});
