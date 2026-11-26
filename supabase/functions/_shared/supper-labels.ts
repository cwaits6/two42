// Supper club labels the app and the reminder run both show, so the page, the
// calendar feed and the reminder email read the same. It must stay free of
// imports: Deno needs ".ts" specifiers, which the app's TypeScript config
// refuses.

/** "Henry and Chloe" from the names of a party's one or two people. */
export function partyName(names: string[]): string {
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : (names[0] ?? "");
}

/** One address line from its parts, skipping the empty ones. */
export function formatAddress(a: {
  address_line1: string;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
}): string {
  const cityLine = [a.city, [a.state, a.postal_code].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [a.address_line1, a.address_line2, cityLine].filter((part) => part && part.trim()).join(", ");
}
