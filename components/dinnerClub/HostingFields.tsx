import type { ReactNode } from "react";
import { FieldError, invalidFieldProps } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface AddressFields {
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  postal_code: string;
}

export const NO_ADDRESS: AddressFields = { address_line1: "", address_line2: "", city: "", state: "", postal_code: "" };

export interface HostingErrors {
  seats?: string;
  line1?: string;
}

const FIELD = "h-12 text-lg";
// Mirrors dinner_parties_seats_check.
const MIN_SEATS = 2;
const MAX_SEATS = 20;

/** What a host must give before publish can seat them: seats and a street address. */
export function hostingErrors(seats: string, address: AddressFields): HostingErrors {
  const count = Number(seats);
  return {
    seats: Number.isInteger(count) && count >= MIN_SEATS && count <= MAX_SEATS ? undefined : "Enter 2 to 20 seats.",
    line1: address.address_line1.trim() ? undefined : "Enter the address for the dinners.",
  };
}

/** The dinner_party_addresses row for an upsert on party_id. */
export function addressRow(keys: { party_id: string; season_id: string; group_id: string }, address: AddressFields) {
  return {
    ...keys,
    address_line1: address.address_line1.trim(),
    address_line2: address.address_line2.trim() || null,
    city: address.city.trim() || null,
    state: address.state.trim() || null,
    postal_code: address.postal_code.trim() || null,
  };
}

export function SeatsField({
  id,
  value,
  error,
  hint,
  onChange,
}: {
  id: string;
  value: string;
  error?: string;
  hint?: ReactNode;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-lg">
        Seats
      </Label>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={MIN_SEATS}
        max={MAX_SEATS}
        value={value}
        className={`${FIELD} sm:w-40`}
        onChange={(e) => onChange(e.target.value)}
        {...invalidFieldProps(id, error)}
      />
      {hint && <p className="text-base text-muted-foreground">{hint}</p>}
      <FieldError fieldId={id} message={error} />
    </div>
  );
}

/** The field caps mirror the dinner_party_addresses checks. */
export function AddressFieldset({
  address,
  line1Id,
  line1Error,
  hint,
  onChange,
}: {
  address: AddressFields;
  line1Id: string;
  line1Error?: string;
  hint?: ReactNode;
  onChange: (key: keyof AddressFields, value: string) => void;
}) {
  const line = (key: keyof AddressFields) => (e: React.ChangeEvent<HTMLInputElement>) => onChange(key, e.target.value);
  return (
    <fieldset className="space-y-3">
      <legend className="text-lg font-medium">Address for the dinners</legend>
      {hint && <p className="text-base text-muted-foreground">{hint}</p>}
      <Input aria-label="Street address" placeholder="Street address" maxLength={200} value={address.address_line1} className={FIELD} onChange={line("address_line1")} {...invalidFieldProps(line1Id, line1Error)} />
      <FieldError fieldId={line1Id} message={line1Error} />
      <Input aria-label="Apartment or unit" placeholder="Apartment or unit" maxLength={200} value={address.address_line2} className={FIELD} onChange={line("address_line2")} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Input aria-label="City" placeholder="City" maxLength={100} value={address.city} className={FIELD} onChange={line("city")} />
        <Input aria-label="State" placeholder="State" maxLength={100} value={address.state} className={FIELD} onChange={line("state")} />
        <Input aria-label="ZIP code" placeholder="ZIP code" maxLength={20} value={address.postal_code} className={FIELD} onChange={line("postal_code")} />
      </div>
    </fieldset>
  );
}
