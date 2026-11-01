import { HEX } from "@/lib/contrast";

export type LabelFormErrors = { name?: string; color?: string };

/** A label's name and color as entered; null is "no color". HEX is the same boundary the database check enforces. */
export function labelFormErrors(form: { name: string; color: string | null }): LabelFormErrors {
  const errors: LabelFormErrors = {};
  if (!form.name.trim()) errors.name = "Enter a label name.";
  if (form.color !== null && !HEX.test(form.color)) errors.color = "Choose a color.";
  return errors;
}
