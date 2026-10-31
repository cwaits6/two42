import { describe, expect, it, vi } from "vitest";
import { mappablePlace, withTimeout, type GeocodeResult } from "./mapPlace";

function result(overrides: Partial<GeocodeResult> = {}): GeocodeResult {
  return {
    formatted_address: "400 Main St, Springfield, IL 62701, USA",
    types: ["street_address"],
    geometry: { location: { lat: () => 39.8, lng: () => -89.6 } },
    ...overrides,
  };
}

describe("mappablePlace", () => {
  it("maps an address the geocoder matched exactly", () => {
    expect(mappablePlace([result()])).toEqual({
      lat: 39.8,
      lng: -89.6,
      address: "400 Main St, Springfield, IL 62701, USA",
    });
  });

  it("maps a named place, not only a street address", () => {
    expect(mappablePlace([result({ types: ["establishment", "point_of_interest"] })])).not.toBeNull();
  });

  it("shows no map when nothing matched", () => {
    expect(mappablePlace([])).toBeNull();
    expect(mappablePlace(null)).toBeNull();
  });

  it("shows no map for a partial match, as text like a room number gets", () => {
    expect(mappablePlace([result({ partial_match: true })])).toBeNull();
  });

  it("shows no map when the best match is a whole town or region", () => {
    expect(mappablePlace([result({ types: ["locality", "political"] })])).toBeNull();
    expect(mappablePlace([result({ types: ["postal_code"] })])).toBeNull();
  });
});

describe("withTimeout", () => {
  it("passes a settled answer through", async () => {
    await expect(withTimeout(Promise.resolve(1), 50)).resolves.toBe(1);
  });

  it("gives up on an answer that never comes", async () => {
    vi.useFakeTimers();
    const pending = withTimeout(new Promise(() => {}), 50);
    vi.advanceTimersByTime(50);
    await expect(pending).rejects.toThrow("timed out");
    vi.useRealTimers();
  });
});
