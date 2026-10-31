// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/components/GoogleMapsScript", () => ({ GoogleMapsScript: () => null }));

const { EventMap } = await import("./EventMap");

const PLACE = {
  formatted_address: "100 Main St, Springfield",
  types: ["street_address"],
  geometry: { location: { lat: () => 39.8, lng: () => -89.6 } },
};

let geocode: () => Promise<unknown>;
let MapCtor: () => void;
let mounted: { root: Root; container: HTMLElement } | null = null;

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY", "test-key");
  geocode = async () => ({ results: [PLACE] });
  MapCtor = () => {};
  const libraries: Record<string, unknown> = {
    geocoding: { Geocoder: class { geocode() { return geocode(); } } },
    maps: { Map: class { constructor() { MapCtor(); } } },
    marker: { Marker: class {} },
  };
  (window as unknown as { google: unknown }).google = {
    maps: { importLibrary: async (name: string) => libraries[name] },
  };
});

afterEach(() => {
  if (mounted) {
    act(() => mounted!.root.unmount());
    mounted.container.remove();
    mounted = null;
  }
  vi.unstubAllEnvs();
  delete (window as unknown as { google?: unknown }).google;
});

async function mount(location = "100 Main St") {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted = { root, container };
  await act(async () => root.render(createElement(EventMap, { location })));
  return container;
}

describe("EventMap", () => {
  it("draws the map and address when the location geocodes to a place", async () => {
    const container = await mount();
    expect(container.textContent).toContain("100 Main St, Springfield");
    expect(container.textContent).toContain("Directions");
  });

  it("renders nothing when the geocoder fails", async () => {
    geocode = async () => {
      throw new Error("ZERO_RESULTS");
    };
    const container = await mount();
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when the map cannot be drawn", async () => {
    MapCtor = () => {
      throw new Error("RefererNotAllowedMapError");
    };
    const container = await mount();
    expect(container.innerHTML).toBe("");
  });

  it("removes the map when Google refuses the key", async () => {
    const container = await mount();
    expect(container.innerHTML).not.toBe("");
    await act(async () => window.gm_authFailure?.());
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing without a key", async () => {
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY", "");
    const container = await mount();
    expect(container.innerHTML).toBe("");
  });
});
