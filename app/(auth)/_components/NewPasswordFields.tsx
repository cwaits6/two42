"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError, invalidFieldProps } from "@/components/ui/field-error";
import { MIN_PASSWORD_LENGTH, type PasswordFieldErrors } from "./passwordRules";

const LABEL = "font-sans text-lg font-semibold tracking-[0.08em] uppercase text-foreground";

/** The password and confirmation pair on the choose-a-password forms. */
export function NewPasswordFields({
  label,
  errors,
  onEdit,
}: {
  label: string;
  errors: PasswordFieldErrors;
  onEdit: (field: keyof PasswordFieldErrors) => void;
}) {
  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor="password" className={LABEL}>
          {label}
        </Label>
        <Input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="new-password"
          placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
          className="h-12 text-lg"
          onChange={() => onEdit("password")}
          {...invalidFieldProps("password", errors.password)}
        />
        <FieldError fieldId="password" message={errors.password} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="confirmPassword" className={LABEL}>
          Confirm password
        </Label>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          required
          autoComplete="new-password"
          placeholder="Enter it again"
          className="h-12 text-lg"
          onChange={() => onEdit("confirmPassword")}
          {...invalidFieldProps("confirmPassword", errors.confirmPassword)}
        />
        <FieldError fieldId="confirmPassword" message={errors.confirmPassword} />
      </div>
    </>
  );
}
