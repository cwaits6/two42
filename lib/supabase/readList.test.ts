import { afterEach, describe, expect, it, vi } from "vitest";
import { readList } from "./readList";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("readList", () => {
  it("returns the rows of a read that succeeded", () => {
    expect(readList({ data: [{ id: 1 }], error: null }, "events")).toEqual([{ id: 1 }]);
  });

  it("returns an empty list, not null, when a read succeeded with no rows", () => {
    expect(readList({ data: [], error: null }, "events")).toEqual([]);
    expect(readList({ data: null, error: null }, "events")).toEqual([]);
  });

  it("returns null when the read failed, and logs only the code and message", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = { code: "42501", message: "permission denied", details: "row: a@b.c" };

    expect(readList({ data: null, error }, "events")).toBeNull();
    expect(log).toHaveBeenCalledWith(
      "Failed to load %s: code=%s message=%s",
      "events",
      "42501",
      "permission denied",
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain("a@b.c");
  });
});
