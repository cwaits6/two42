// What each guest party brings to a dinner: the options the host picks from,
// and Suggest, which fills the list for them to change.

export const BRING_OPTIONS = ["Side", "Salad", "Dessert", "Drinks", "Bread"] as const;

/** The limit dinner_contributions_item_check holds an item to. */
export const BRING_ITEM_MAX = 60;

/** An item as stored: trimmed, 1 to 60 characters, or null when it is not one. */
export function bringItem(value: string): string | null {
  const item = value.trim();
  return item.length >= 1 && item.length <= BRING_ITEM_MAX ? item : null;
}

/**
 * One option for each guest party. In order of weight: not what the party
 * brought to its last dinner; not what another guest at this dinner brings,
 * while options remain; what the party has brought least often, then least
 * recently. Remaining ties rotate with the dinner, so the same guests get
 * different options each time. Deterministic: guests go in party id order.
 */
export function suggestBringList({
  guestPartyIds,
  earlier,
  dinnerIndex,
}: {
  guestPartyIds: string[];
  /** Each party's items at this season's earlier dinners, oldest first. */
  earlier: Record<string, string[]>;
  /** This dinner's place in the season, to rotate ties. */
  dinnerIndex: number;
}): Record<string, string> {
  const options: readonly string[] = BRING_OPTIONS;
  const n = options.length;
  const taken = new Map<string, number>();
  const out: Record<string, string> = {};
  [...guestPartyIds].sort().forEach((partyId, position) => {
    const past = (earlier[partyId] ?? []).filter((item) => options.includes(item));
    const last = earlier[partyId]?.at(-1);
    const target = (dinnerIndex + position) % n;
    const cost = (option: string, index: number) =>
      (option === last ? 1e6 : 0) +
      (taken.get(option) ?? 0) * 1e4 +
      past.filter((item) => item === option).length * 100 +
      (past.lastIndexOf(option) + 1) +
      ((index - target + n) % n) / 100;
    let best = 0;
    options.forEach((option, index) => {
      if (cost(option, index) < cost(options[best], best)) best = index;
    });
    out[partyId] = options[best];
    taken.set(options[best], (taken.get(options[best]) ?? 0) + 1);
  });
  return out;
}
