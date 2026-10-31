// What the Maps JavaScript geocoder answers, narrowed to the fields the event
// map reads. lat/lng are methods on the live LatLng object.
export type GeocodeResult = {
  formatted_address: string;
  partial_match?: boolean;
  types: string[];
  geometry: { location: { lat: () => number; lng: () => number } };
};

export type MappablePlace = { lat: number; lng: number; address: string };

// A result that is only one of these is a whole area, not a place to meet.
const AREA_TYPES = new Set([
  "political",
  "country",
  "administrative_area_level_1",
  "administrative_area_level_2",
  "administrative_area_level_3",
  "locality",
  "sublocality",
  "postal_code",
  "colloquial_area",
]);

/**
 * The place an event's location names, or null when the geocoder only
 * guessed: no result, a partial match ("Room 242" matched to some street),
 * or nothing finer than a town.
 */
export function mappablePlace(results: readonly GeocodeResult[] | null | undefined): MappablePlace | null {
  const top = results?.[0];
  if (!top || top.partial_match) return null;
  if (top.types.every((t) => AREA_TYPES.has(t))) return null;
  return {
    lat: top.geometry.location.lat(),
    lng: top.geometry.location.lng(),
    address: top.formatted_address,
  };
}

/** Rejects after `ms`: a key the API refuses can leave the geocoder's promise unsettled. */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timed out")), ms)),
  ]);
}
