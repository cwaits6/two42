"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { invalidFieldProps } from "@/components/ui/field-error";
import { MONTHS } from "@/components/profile/birthday";

// A blank value keeps the trigger on its placeholder, so "No date" reads as
// "Month" once chosen, the same as a date never entered.
const CHOICES = [{ value: "", label: "No date" }, ...MONTHS];

/**
 * The month of a birthday or anniversary. `onChange` gets "" for "No date";
 * the form clears the day and year with it, so the save clears the whole date.
 */
export function MonthSelect({
  id,
  value,
  onChange,
  error,
  className = "w-full py-5 text-base",
  "aria-label": ariaLabel,
}: {
  id: string;
  value: string;
  onChange: (month: string) => void;
  error: string | undefined;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <Select items={CHOICES} value={value} onValueChange={(v) => onChange(v ?? "")}>
      <SelectTrigger
        id={id}
        aria-label={ariaLabel}
        className={className}
        {...invalidFieldProps(id, error)}
      >
        <SelectValue placeholder="Month" />
      </SelectTrigger>
      <SelectContent>
        {CHOICES.map((m) => (
          <SelectItem key={m.value} value={m.value}>
            {m.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
