"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import { GoogleMapsScript } from "@/components/GoogleMapsScript";
import { mappablePlace, withTimeout, type GeocodeResult, type MappablePlace } from "@/components/events/mapPlace";

declare global {
  interface Window {
    /** Called by the Maps JavaScript API when it refuses the key. */
    gm_authFailure?: () => void;
  }
}

const SCRIPT_WAIT_MS = 5000;
const GEOCODE_WAIT_MS = 8000;

async function mapsReady(): Promise<boolean> {
  const deadline = Date.now() + SCRIPT_WAIT_MS;
  while (!window.google?.maps?.importLibrary) {
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, 200));
  }
  return true;
}

/**
 * The map for an event's location, drawn only once the location geocodes to
 * a real place. Anything else — text like "Room 242", no key, a refused key,
 * a slow or failed request — renders nothing at all.
 */
export function EventMap({ location }: { location: string }) {
  const [place, setPlace] = useState<MappablePlace | null>(null);
  const [failed, setFailed] = useState(false);
  const mapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const previousAuthFailure = window.gm_authFailure;
    window.gm_authFailure = () => {
      if (!cancelled) setFailed(true);
      previousAuthFailure?.();
    };

    (async () => {
      try {
        if (!(await mapsReady())) return;
        const { Geocoder } = await window.google!.maps!.importLibrary("geocoding");
        const { results } = (await withTimeout(
          new Geocoder().geocode({ address: location }),
          GEOCODE_WAIT_MS
        )) as { results: GeocodeResult[] };
        if (!cancelled) setPlace(mappablePlace(results));
      } catch {
        // ZERO_RESULTS, a refused key and a timeout all mean no map.
      }
    })();

    return () => {
      cancelled = true;
      window.gm_authFailure = previousAuthFailure;
    };
  }, [location]);

  useEffect(() => {
    if (!place || !mapRef.current) return;
    const container = mapRef.current;
    (async () => {
      try {
        const { Map } = await window.google!.maps!.importLibrary("maps");
        const { Marker } = await window.google!.maps!.importLibrary("marker");
        const position = { lat: place.lat, lng: place.lng };
        const map = new Map(container, {
          center: position,
          zoom: 15,
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: "cooperative",
          clickableIcons: false,
        });
        new Marker({ map, position, title: place.address });
      } catch {
        setFailed(true);
      }
    })();
  }, [place]);

  if (!process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY) return null;
  if (!place || failed) return <GoogleMapsScript />;

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <GoogleMapsScript />
      <div ref={mapRef} className="aspect-[4/3] w-full bg-muted" />
      <div className="flex items-center justify-between gap-3 px-4 py-2">
        <span className="min-w-0 truncate font-sans text-base text-muted-foreground">{place.address}</span>
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap font-sans text-base font-semibold text-brand-primary-text hover:underline"
        >
          Directions
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">(opens Google Maps)</span>
        </a>
      </div>
    </div>
  );
}
