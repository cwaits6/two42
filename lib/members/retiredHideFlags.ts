type FieldValue = string | number | null;

const FLAG_FIELDS = {
  hide_phone_mobile: ["phone_mobile"],
  hide_phone_home: ["phone_home"],
  hide_phone_work: ["phone_work"],
  hide_address: ["address_line1", "address_line2", "city", "state", "postal_code"],
  hide_birthday: ["birth_month", "birth_day"],
  hide_birth_year: ["birth_year"],
  hide_occupation: ["occupation", "employer"],
} as const;

type RetiredFlag = keyof typeof FLAG_FIELDS;
type FlaggedField = (typeof FLAG_FIELDS)[RetiredFlag][number];
type FlaggedValues = { readonly [F in FlaggedField]?: FieldValue };

const isBlank = (value: FieldValue | undefined) => value === null || value === undefined || value === "";

/**
 * The flags a profile write has to reset. `directory_retire_hidden_values()` deletes
 * whatever a flag covers, so a new value left under its flag is deleted too. A flag
 * stays while any value it hid is unchanged: that value was hidden, and resetting
 * would show it. A field missing from `next` is unchanged.
 * Remove once the retired columns are dropped.
 */
export function retiredFlagResets(
  previous: FlaggedValues,
  next: FlaggedValues,
): Partial<Record<RetiredFlag, false>> {
  const resets: Partial<Record<RetiredFlag, false>> = {};
  for (const flag of Object.keys(FLAG_FIELDS) as RetiredFlag[]) {
    const fields: readonly FlaggedField[] = FLAG_FIELDS[flag];
    const entered = fields.some((f) => !isBlank(next[f]) && next[f] !== previous[f]);
    const hiddenValueKept = fields.some(
      (f) => !isBlank(previous[f]) && (next[f] === undefined || next[f] === previous[f]),
    );
    if (entered && !hiddenValueKept) resets[flag] = false;
  }
  return resets;
}
