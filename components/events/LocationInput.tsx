"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

declare global {
  interface Window {
    google?: {
      maps?: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        importLibrary: (lib: string) => Promise<any>;
      };
    };
  }
}

interface PlacePrediction {
  text?: { text?: string };
  mainText?: { text?: string } | null;
  secondaryText?: { text?: string } | null;
  toPlace: () => {
    fetchFields: (options: { fields: string[] }) => Promise<unknown>;
    formattedAddress?: string | null;
    displayName?: string | null;
  };
}

const MIN_QUERY_LENGTH = 3;
const DEBOUNCE_MS = 250;
const SCRIPT_WAIT_MS = 5000;

async function placesLibrary() {
  const deadline = Date.now() + SCRIPT_WAIT_MS;
  while (!window.google?.maps?.importLibrary) {
    if (Date.now() > deadline) return null;
    await new Promise((r) => setTimeout(r, 200));
  }
  return window.google.maps.importLibrary("places");
}

interface LocationInputProps {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  name?: string;
}

/**
 * A plain text field with Google's address suggestions under it. The typed
 * text is always the value, so "Room 242" saves as written and the field still
 * works when Google is refused or down; the suggestions only ever add to it.
 */
export function LocationInput({ value, onChange, id, name }: LocationInputProps) {
  const listId = useId();
  const [predictions, setPredictions] = useState<PlacePrediction[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestEdit = useRef(0);
  const latestRequest = useRef(0);
  // A token groups a person's keystrokes and their pick into one billed session.
  const sessionToken = useRef<unknown>(null);

  useEffect(
    () => () => {
      if (debounce.current) clearTimeout(debounce.current);
      latestEdit.current += 1;
      latestRequest.current += 1;
    },
    [],
  );

  const open = predictions.length > 0;

  // Also drops any request still on its way, so a late answer can't reopen the list.
  const close = () => {
    if (debounce.current) clearTimeout(debounce.current);
    latestRequest.current += 1;
    setPredictions([]);
    setActiveIndex(-1);
  };

  const fetchPredictions = async (input: string, request: number) => {
    try {
      const places = await placesLibrary();
      if (!places) return;
      sessionToken.current ??= new places.AutocompleteSessionToken();
      const { suggestions } = await places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
        input,
        sessionToken: sessionToken.current,
      });
      if (request !== latestRequest.current) return;
      setPredictions(
        (suggestions as { placePrediction?: PlacePrediction | null }[]).flatMap((s) =>
          s.placePrediction ? [s.placePrediction] : [],
        ),
      );
      setActiveIndex(-1);
    } catch (error) {
      console.error("Location suggestions unavailable", error);
      if (request === latestRequest.current) close();
    }
  };

  const handleType = (next: string) => {
    onChange(next);
    setActiveIndex(-1);
    latestEdit.current += 1;
    if (debounce.current) clearTimeout(debounce.current);
    const request = ++latestRequest.current;
    if (next.trim().length < MIN_QUERY_LENGTH) {
      close();
      return;
    }
    debounce.current = setTimeout(() => fetchPredictions(next, request), DEBOUNCE_MS);
  };

  const pick = async (prediction: PlacePrediction) => {
    const edit = ++latestEdit.current;
    close();
    onChange(prediction.text?.text ?? "");
    sessionToken.current = null;
    try {
      const place = prediction.toPlace();
      await place.fetchFields({ fields: ["formattedAddress", "displayName"] });
      const address = place.formattedAddress ?? place.displayName;
      if (address && edit === latestEdit.current) onChange(address);
    } catch (error) {
      // The suggestion's own text is already in the field, and it is a usable address.
      console.error("Location details unavailable", error);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!open) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((current) => {
        // -1 is the typed text, one stop in the cycle alongside the suggestions.
        const stops = predictions.length + 1;
        return ((current + 1 + step + stops) % stops) - 1;
      });
    } else if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      void pick(predictions[activeIndex]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  };

  return (
    <div className="relative">
      <Input
        id={id}
        name={name}
        value={value}
        onChange={(event) => handleType(event.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={close}
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
      />
      {open && (
        <div className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-md">
          <ul id={listId} role="listbox" aria-label="Suggested addresses">
            {predictions.map((prediction, index) => (
              <li
                key={`${prediction.text?.text}-${index}`}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                // Keeps focus in the field, so its blur doesn't close the list before the click lands.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void pick(prediction)}
                onMouseEnter={() => setActiveIndex(index)}
                className={cn(
                  "flex min-h-12 cursor-pointer flex-col justify-center px-3 py-2",
                  index === activeIndex && "bg-accent text-accent-foreground",
                )}
              >
                <span className="text-base font-medium">
                  {prediction.mainText?.text ?? prediction.text?.text}
                </span>
                {prediction.secondaryText?.text && (
                  <span className="text-sm text-muted-foreground">{prediction.secondaryText.text}</span>
                )}
              </li>
            ))}
          </ul>
          {/* Google's terms require this wherever its suggestions appear without its map. */}
          <p className="border-t border-border px-3 py-1.5 text-right text-sm text-muted-foreground">
            Google Maps
          </p>
        </div>
      )}
    </div>
  );
}
