"use client";

import { cn } from "@/lib/utils";
import type { Gender } from "@/lib/types";

const OPTIONS: { value: Gender; label: string }[] = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
];

/** Two large choices; pressing the chosen one again clears it. */
export function GenderChoice({
  value,
  onChange,
  labelledBy,
}: {
  value: Gender | null;
  onChange: (value: Gender | null) => void;
  labelledBy: string;
}) {
  return (
    <div role="group" aria-labelledby={labelledBy} className="grid grid-cols-2 gap-3">
      {OPTIONS.map((option) => {
        const pressed = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={pressed}
            onClick={() => onChange(pressed ? null : option.value)}
            className={cn(
              "min-h-14 rounded-xl border-2 px-4 text-lg font-semibold transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              pressed
                ? "border-primary bg-primary text-primary-foreground"
                : "border-input bg-card text-foreground hover:bg-brand-warm",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
