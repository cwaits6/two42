"use client";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FieldError, invalidFieldProps } from "@/components/ui/field-error";
import { MONTHS, type AnniversaryErrors } from "@/components/profile/birthday";

export type AnniversaryField = keyof AnniversaryErrors;

/** Month, day and optional year. Each field's id is `idPrefix` plus its column name. */
export function AnniversaryFields({
  idPrefix = "",
  month,
  day,
  year,
  onChange,
  errors,
}: {
  idPrefix?: string;
  month: string;
  day: string;
  year: string;
  onChange: (field: AnniversaryField, value: string) => void;
  errors: AnniversaryErrors;
}) {
  const id = (field: AnniversaryField) => `${idPrefix}${field}`;
  return (
    <>
      <div className="grid grid-cols-[1.6fr_1fr_1fr] gap-3">
        <Select
          items={MONTHS}
          value={month}
          onValueChange={(v) => onChange("anniversary_month", v ?? "")}
        >
          <SelectTrigger
            id={id("anniversary_month")}
            aria-label="Anniversary month"
            className="w-full py-5 text-base"
            {...invalidFieldProps(id("anniversary_month"), errors.anniversary_month)}
          >
            <SelectValue placeholder="Month" />
          </SelectTrigger>
          <SelectContent>
            {MONTHS.map((m) => (
              <SelectItem key={m.value} value={m.value}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          id={id("anniversary_day")}
          type="number"
          min="1"
          max="31"
          placeholder="Day"
          aria-label="Anniversary day"
          value={day}
          onChange={(e) => onChange("anniversary_day", e.target.value)}
          className="py-5 text-base"
          {...invalidFieldProps(id("anniversary_day"), errors.anniversary_day)}
        />
        <Input
          id={id("anniversary_year")}
          type="number"
          min="1900"
          placeholder="Year"
          aria-label="Anniversary year (optional)"
          value={year}
          onChange={(e) => onChange("anniversary_year", e.target.value)}
          className="py-5 text-base"
          {...invalidFieldProps(id("anniversary_year"), errors.anniversary_year)}
        />
      </div>
      <FieldError fieldId={id("anniversary_month")} message={errors.anniversary_month} />
      <FieldError fieldId={id("anniversary_day")} message={errors.anniversary_day} />
      <FieldError fieldId={id("anniversary_year")} message={errors.anniversary_year} />
      <p className="text-base text-muted-foreground">The year is optional.</p>
    </>
  );
}
