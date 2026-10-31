// The calendar page's view and "Showing" filter, as a reducer so the rule
// that switching views never touches the filter is testable without a DOM.

export type CalendarView = "month" | "week" | "list";

export const CALENDAR_VIEWS: { value: CalendarView; label: string }[] = [
  { value: "month", label: "Month" },
  { value: "week", label: "Week" },
  { value: "list", label: "List" },
];

/** Below Tailwind's `md` breakpoint a month grid is too narrow to read. */
export const PHONE_QUERY = "(max-width: 767px)";

export type CalendarViewState = {
  /** The view the member picked; null until they pick one, so the width decides. */
  chosenView: CalendarView | null;
  groupIds: readonly string[];
  visibleGroupIds: ReadonlySet<string>;
};

export type CalendarViewAction =
  | { type: "setView"; view: CalendarView }
  | { type: "toggleGroup"; id: string }
  | { type: "showAll" };

export function initialCalendarViewState(groupIds: readonly string[]): CalendarViewState {
  return { chosenView: null, groupIds, visibleGroupIds: new Set(groupIds) };
}

/** The view on screen: the member's pick, else List on a phone and Month wider. */
export function shownView(state: CalendarViewState, isPhone: boolean): CalendarView {
  return state.chosenView ?? (isPhone ? "list" : "month");
}

export function calendarViewReducer(
  state: CalendarViewState,
  action: CalendarViewAction
): CalendarViewState {
  switch (action.type) {
    case "setView":
      return { ...state, chosenView: action.view };
    case "toggleGroup": {
      const next = new Set(state.visibleGroupIds);
      if (next.has(action.id)) next.delete(action.id);
      else next.add(action.id);
      return { ...state, visibleGroupIds: next };
    }
    case "showAll":
      return { ...state, visibleGroupIds: new Set(state.groupIds) };
  }
}
