import { afterEach, describe, expect, it, vi } from "vitest";
import { readList } from "./readList";
import { loggedLines } from "@/lib/log/testing";

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

  it("returns null when the read failed, and logs only the code", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = { code: "42501", message: "permission denied for a@b.c", details: "row: a@b.c" };

    expect(readList({ data: null, error }, "events")).toBeNull();
    expect(loggedLines(log)).toEqual([
      expect.objectContaining({ what: "Failed to load", step: "events", code: "42501" }),
    ]);
    expect(JSON.stringify(log.mock.calls)).not.toContain("a@b.c");
  });
});
