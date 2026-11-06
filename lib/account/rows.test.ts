import { afterEach, describe, expect, it, vi } from "vitest";
import { loggedLines } from "@/lib/log/testing";
import { rowsOf } from "./rows";

afterEach(() => vi.restoreAllMocks());

describe("rowsOf", () => {
  it("logs a failed read's code and step before throwing, since the caller only sees an Error", () => {
    const logged = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = { code: "57014", message: "canceling statement due to statement timeout" };

    expect(() => rowsOf({ data: null, error }, "household entries")).toThrow();
    expect(loggedLines(logged)).toEqual([
      expect.objectContaining({ what: "Account data read failed", step: "household_entries", code: "57014" }),
    ]);
  });

  it("returns the rows of a read that worked, and logs nothing", () => {
    const logged = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(rowsOf({ data: [{ id: 1 }], error: null }, "profile")).toEqual([{ id: 1 }]);
    expect(logged).not.toHaveBeenCalled();
  });
});
