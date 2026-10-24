// The calendar page's view and "Showing" filter, as a reducer so the rule
// that switching views never touches the filter is testable without a DOM.

export type CalendarView = "month" | "week" | "list";

export const CALENDAR_VIEWS: { value: CalendarView; label: string }[] = [
  { value: "month", label: "Month" },
  { value: "week", label: "Week" },
  { value: "list", label: "List" },
];

export type CalendarViewState = {
  view: CalendarView;
  groupIds: readonly string[];
  visibleGroupIds: ReadonlySet<string>;
};

export type CalendarViewAction =
  | { type: "setView"; view: CalendarView }
  | { type: "toggleGroup"; id: string }
  | { type: "showAll" };

export function initialCalendarViewState(groupIds: readonly string[]): CalendarViewState {
  return { view: "month", groupIds, visibleGroupIds: new Set(groupIds) };
}

export function calendarViewReducer(
  state: CalendarViewState,
  action: CalendarViewAction
): CalendarViewState {
  switch (action.type) {
    case "setView":
      return { ...state, view: action.view };
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
