/** A caller's fixed label, such as "group requests", in the shape the log line's `step` accepts. */
export function stepOf(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}
