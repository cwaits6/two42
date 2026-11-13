import { toWallRow } from "@/lib/prayer";
import type { PrayerWallRow } from "@/lib/types";
import { decryptBody, isAuthor, type PrayerKeys } from "./crypto";

const text = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/**
 * prayer_wall rows as the board renders them: the text opened, and `mine` also
 * true on the viewer's own anonymous requests, which the view cannot tell. A
 * row not yet converted still carries plaintext body. Throws when any text
 * cannot be opened, so a caller shows its failed state rather than a partial
 * wall or ciphertext.
 */
export function openWallRows(
  raws: readonly Record<string, unknown>[],
  opts: { viewerId: string; keys: PrayerKeys },
): PrayerWallRow[] {
  return raws.map((raw) => {
    const id = text(raw.id) ?? "";
    const orgId = text(raw.org_id) ?? "";
    const sealed = text(raw.body_ciphertext);
    const hash = text(raw.author_hash);
    return toWallRow({
      ...raw,
      body: sealed ? decryptBody(opts.keys, orgId, id, sealed) : raw.body,
      mine:
        raw.mine === true ||
        (raw.is_anonymous === true && hash !== null && isAuthor(opts.keys, orgId, id, opts.viewerId, hash)),
    });
  });
}
