export type LoggedLine = {
  level: "error" | "warn" | "info";
  what: string;
  route?: string;
  step?: string;
  code?: string;
  ref: string;
  ids?: Record<string, string | number>;
};

/** The lines a test's `vi.spyOn(console, "log")` captured, parsed. */
export function loggedLines(spy: { mock: { calls: unknown[][] } }): LoggedLine[] {
  return spy.mock.calls.map(([line]) => JSON.parse(String(line)) as LoggedLine);
}
