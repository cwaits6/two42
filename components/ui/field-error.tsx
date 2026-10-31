function fieldErrorId(fieldId: string): string {
  return `${fieldId}-error`;
}

/**
 * Props for the control a message belongs to. The message is read through
 * aria-describedby when focus lands on the field, so it carries no alert
 * role of its own — a form with several errors would otherwise announce
 * every one at once.
 */
export function invalidFieldProps(fieldId: string, message: string | undefined) {
  return message
    ? { "aria-invalid": true, "aria-describedby": fieldErrorId(fieldId) }
    : {};
}

/** The message beside the field it belongs to. */
export function FieldError({ fieldId, message }: { fieldId: string; message: string | undefined }) {
  if (!message) return null;
  return (
    <p id={fieldErrorId(fieldId)} className="text-base text-destructive">
      {message}
    </p>
  );
}
