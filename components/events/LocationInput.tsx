"use client";

import { useEffect, useRef } from "react";

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    google?: {
      maps?: {
        importLibrary: (lib: string) => Promise<any>;
        places?: {
          PlaceAutocompleteElement: new () => HTMLElement & {
            addEventListener: (type: string, handler: any) => void;
            removeEventListener: (type: string, handler: any) => void;
          };
          Place?: {
            prototype?: {
              fetchFields?: (options: { fields: string[] }) => Promise<unknown>;
            };
          };
        };
      };
    };
  }
}

interface LocationInputProps {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  name?: string;
}

export function LocationInput({ value, onChange, id, name }: LocationInputProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const elRef = useRef<HTMLElement | null>(null);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const readShadowInput = (el: HTMLElement | null) => {
    const shadow = (el as { shadowRoot?: ShadowRoot | null } | null)?.shadowRoot;
    const input = shadow?.querySelector("input");
    return input instanceof HTMLInputElement ? input : null;
  };

  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    const container = containerRef.current;

    async function init() {
      while (!window.google?.maps) {
        if (cancelled) return;
        if (attempts++ >= 25) return;
        await new Promise((r) => setTimeout(r, 200));
      }

      await window.google!.maps!.importLibrary("places");

      if (cancelled || elRef.current || !container) return;
      if (!window.google?.maps?.places?.PlaceAutocompleteElement) return;

      const el = new window.google.maps.places.PlaceAutocompleteElement();
      if (id) (el as any).id = id;

      // Style the host element so CSS custom properties cascade into the shadow DOM
      Object.assign((el as HTMLElement).style, {
        width: "100%",
        height: "3rem",
        display: "block",
        borderRadius: "0.375rem",
        border: "0",
        color: "hsl(var(--foreground, 222.2 84% 4.9%))",
        backgroundColor: "transparent",
        fontSize: "1rem",
      });

      elRef.current = el;

      // Inject styles into shadow root once it's available to fix invisible text
      const injectShadowStyles = () => {
        const shadow = (el as any).shadowRoot as ShadowRoot | null;
        if (!shadow) return;
        const style = document.createElement("style");
        style.textContent = `
          input {
            color: inherit !important;
            background-color: transparent !important;
            caret-color: currentColor !important;
            padding: 0 0.75rem !important;
            height: 100% !important;
            width: 100% !important;
            box-sizing: border-box !important;
            outline: none !important;
            font-size: inherit !important;
            border: 0 !important;
            border-radius: 0 !important;
            display: block !important;
            box-shadow: none !important;
          }

          input:focus {
            border: 0 !important;
          }
        `;
        shadow.appendChild(style);
      };

      const handleSelect = async (event: any) => {
        const placeFromEvent = event.place;
        const placePrediction = event.placePrediction;
        const place =
          placeFromEvent ??
          (placePrediction?.toPlace ? placePrediction.toPlace() : null);

        // Use requestAnimationFrame so the element's internal input has updated first.
        requestAnimationFrame(async () => {
          let addr = readShadowInput(el)?.value ?? "";

          if (place) {
            try {
              await place.fetchFields({ fields: ["formattedAddress", "displayName"] });
              addr = place.formattedAddress ?? place.displayName ?? addr;
            } catch {
              // Keep whatever value the widget input already has.
            }
          }

          onChangeRef.current(addr);
        });
      };

      container.appendChild(el);

      // The new Places widget uses gmp-select. Keep gmp-placeselect as a compatibility fallback.
      el.addEventListener("gmp-select", handleSelect);
      el.addEventListener("gmp-placeselect", handleSelect);

      // The Google element renders its real input in shadow DOM, so sync typing both ways.
      const attachShadowListeners = (tries = 0) => {
        if (cancelled) return;

        const shadow = (el as any).shadowRoot as ShadowRoot | null;
        const input = readShadowInput(el);

        if (!shadow || !input) {
          if (tries < 20) setTimeout(() => attachShadowListeners(tries + 1), 100);
          return;
        }

        const syncInputValue = () => {
          onChangeRef.current(input.value);
        };

        injectShadowStyles();
        input.addEventListener("input", syncInputValue);
        input.addEventListener("change", syncInputValue);

        (el as any)._shadowCleanup = () => {
          input.removeEventListener("input", syncInputValue);
          input.removeEventListener("change", syncInputValue);
        };
      };

      attachShadowListeners();

      (el as any)._cleanup = () => {
        el.removeEventListener("gmp-select", handleSelect);
        el.removeEventListener("gmp-placeselect", handleSelect);
        (el as any)._shadowCleanup?.();
      };
    }

    init();
    return () => {
      cancelled = true;
      const el = elRef.current;
      if (el) {
        (el as any)._cleanup?.();
        if (container?.contains(el)) container.removeChild(el);
      }
      elRef.current = null;
    };
  }, [id]);

  useEffect(() => {
    const input = readShadowInput(elRef.current);
    if (input && input.value !== value) {
      input.value = value;
    }
  }, [value]);

  return (
    <div className="space-y-1.5">
      <div className="relative w-full">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-lg border border-input bg-transparent"
        />
        <div ref={containerRef} className="relative z-10 w-full" />
      </div>
      <input type="hidden" id={id ? `${id}-hidden` : undefined} name={name} value={value} readOnly />
      {value && (
        <p className="text-base text-muted-foreground px-1 truncate">
          Saved: {value}
        </p>
      )}
    </div>
  );
}
