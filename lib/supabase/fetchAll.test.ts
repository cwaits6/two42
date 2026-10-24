import { describe, expect, it, vi } from "vitest";
import { fetchAll } from "@/lib/supabase/fetchAll";

function source(total: number) {
  const all = Array.from({ length: total }, (_, i) => ({ id: i }));
  return vi.fn(async (from: number, to: number) => ({
    data: all.slice(from, to + 1),
    error: null as string | null,
  }));
}

describe("fetchAll", () => {
  it("returns a single short page without a second request", async () => {
    const page = source(3);
    const result = await fetchAll(page, 5);
    expect(result.data).toHaveLength(3);
    expect(page).toHaveBeenCalledTimes(1);
  });

  it("concatenates pages in order past the page size", async () => {
    const page = source(12);
    const result = await fetchAll(page, 5);
    expect(result.error).toBeNull();
    expect(result.data?.map((r) => r.id)).toEqual(Array.from({ length: 12 }, (_, i) => i));
    expect(page.mock.calls).toEqual([
      [0, 4],
      [5, 9],
      [10, 14],
    ]);
  });

  it("requests one extra empty page when the total is an exact multiple", async () => {
    const page = source(10);
    const result = await fetchAll(page, 5);
    expect(result.data).toHaveLength(10);
    expect(page).toHaveBeenCalledTimes(3);
  });

  it("returns an empty array for no rows", async () => {
    const result = await fetchAll(source(0), 5);
    expect(result).toEqual({ data: [], error: null });
  });

  it("stops at the first error and returns no data", async () => {
    const page = vi
      .fn()
      .mockResolvedValueOnce({ data: [{ id: 1 }, { id: 2 }], error: null })
      .mockResolvedValueOnce({ data: null, error: "boom" });
    const result = await fetchAll<{ id: number }, string>(page, 2);
    expect(result).toEqual({ data: null, error: "boom" });
    expect(page).toHaveBeenCalledTimes(2);
  });
});
