/**
 * A choice saved with the rest of its form. A switch would suggest it applies
 * the moment it is flipped, which only Settings' notification switch does.
 */
export function CheckRow({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      htmlFor={id}
      className="flex min-h-11 cursor-pointer items-center gap-3 py-1 text-base font-medium text-foreground"
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-5 shrink-0 accent-brand-primary"
      />
      {label}
    </label>
  );
}
