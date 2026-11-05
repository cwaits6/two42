import type { LogLine } from "./core";

export type LoggedLine = LogLine;

/** The lines a test's `vi.spyOn(console, "log")` captured, parsed. */
export function loggedLines(spy: { mock: { calls: unknown[][] } }): LoggedLine[] {
  return spy.mock.calls.map(([line]) => JSON.parse(String(line)) as LoggedLine);
}
