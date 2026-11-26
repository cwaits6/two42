// What each guest party brings to a supper: the options the host picks from,
// and Suggest, which fills the list for them to change.

export const BRING_OPTIONS = ["Side", "Salad", "Dessert", "Drinks", "Bread"] as const;

/** The limit supper_contributions_item_check holds an item to. */
export const BRING_ITEM_MAX = 60;

/** An item as stored: trimmed, 1 to 60 characters, or null when it is not one. */
export function bringItem(value: string): string | null {
  const item = value.trim();
  // char_length counts code points; String.length counts UTF-16 units.
  const length = [...item].length;
  return length >= 1 && length <= BRING_ITEM_MAX ? item : null;
}

/**
 * One option for each guest party. In order of weight: not what the party
 * brought to its last supper; not what another guest at this supper brings,
 * while options remain; what the party has brought least often, then least
 * recently. Remaining ties rotate with the supper, so the same guests get
 * different options each time. Deterministic: guests go in party id order.
 */
export function suggestBringList({
  guestPartyIds,
  earlier,
  supperIndex,
}: {
  guestPartyIds: string[];
  /** Each party's items at this rotation's earlier suppers, oldest first. */
  earlier: Record<string, string[]>;
  /** This supper's place in the rotation, to rotate ties. */
  supperIndex: number;
}): Record<string, string> {
  const options: readonly string[] = BRING_OPTIONS;
  const n = options.length;
  const taken = new Map<string, number>();
  const out: Record<string, string> = {};
  [...guestPartyIds].sort().forEach((partyId, position) => {
    const past = (earlier[partyId] ?? []).filter((item) => options.includes(item));
    const last = earlier[partyId]?.at(-1);
    const target = (supperIndex + position) % n;
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

/**
 * What the bring-list editor needs for one supper: its guest parties (seated
 * now, host left out) with their items, and for Suggest each guest's items at
 * this rotation's strictly earlier suppers, oldest first.
 */
export function bringListFor(
  supper: { id: string; table_id: string; rotation_date_id: string; starts_at: string; host_party_id: string | null },
  rotation: {
    dates: { id: string }[];
    suppers: { id: string; starts_at: string }[];
    seats: { table_id: string; party_id: string; left_at: string | null }[];
    contributions: { supper_id: string; party_id: string; item: string }[];
  },
  namesOf: (partyId: string) => string
): {
  guests: { partyId: string; names: string; item: string | null }[];
  earlier: Record<string, string[]>;
  supperIndex: number;
} {
  const startsOf = new Map(rotation.suppers.map((d) => [d.id, d.starts_at]));
  const guestIds = rotation.seats
    .filter((s) => s.table_id === supper.table_id && !s.left_at && s.party_id !== supper.host_party_id)
    .map((s) => s.party_id);
  return {
    guests: guestIds.map((partyId) => ({
      partyId,
      names: namesOf(partyId),
      item: rotation.contributions.find((c) => c.supper_id === supper.id && c.party_id === partyId)?.item ?? null,
    })),
    earlier: Object.fromEntries(
      guestIds.map((partyId) => [
        partyId,
        rotation.contributions
          .flatMap((c) => {
            const starts = startsOf.get(c.supper_id);
            return c.party_id === partyId && starts !== undefined && starts < supper.starts_at ? [{ starts, item: c.item }] : [];
          })
          .sort((a, b) => a.starts.localeCompare(b.starts))
          .map((c) => c.item),
      ])
    ),
    supperIndex: Math.max(0, rotation.dates.findIndex((d) => d.id === supper.rotation_date_id)),
  };
}
