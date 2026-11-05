import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("react");
});

function refs(spy: ReturnType<typeof vi.spyOn>) {
  return spy.mock.calls.map(([line]) => JSON.parse(line as string).ref as string);
}

describe("request reference", () => {
  it("is shared by every line logged in one server render, and is what the failed state reads", async () => {
    // Stands in for a server component render, where React memoizes cache().
    vi.doMock("react", () => ({
      cache: <T,>(make: () => T) => {
        let made: { value: T } | null = null;
        return () => (made ??= { value: make() }).value;
      },
    }));
    const { logError, logWarn, requestReference } = await import("./index");
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    expect(requestReference()).toBeNull();
    const first = logError("Events read failed", { code: "PGRST301" });
    const second = logWarn("Teams read failed", { code: "PGRST301" });

    expect(second).toBe(first);
    expect(refs(spy)).toEqual([first, first]);
    expect(requestReference()).toBe(first);
  });

  it("is new for each line outside a server render, where nothing reads it back", async () => {
    const { logError, requestReference } = await import("./index");
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    const first = logError("Save failed", { code: "23505" });
    const second = logError("Save failed", { code: "23505" });

    expect(second).not.toBe(first);
    expect(refs(spy)).toEqual([first, second]);
    expect(requestReference()).toBeNull();
  });
});
