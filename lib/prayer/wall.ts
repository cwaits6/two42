import { toWallRow } from "@/lib/prayer";
import type { Tables } from "@/lib/supabase/database.types";
import type { PrayerWallRow } from "@/lib/types";
import { decryptBody, isAuthor, type PrayerKeys } from "./crypto";

export type SealedWallRow = Pick<
  Tables<"prayer_wall">,
  "id" | "org_id" | "body" | "body_ciphertext" | "is_anonymous" | "author_hash" | "mine"
>;

/**
 * prayer_wall rows as the board renders them: the text opened, and `mine` also
 * true on the viewer's own anonymous requests, which the view cannot tell. A
 * row not yet converted still carries plaintext body. Throws when any text
 * cannot be opened, so a caller shows its failed state rather than a partial
 * wall or ciphertext.
 */
export function openWallRows(
  raws: readonly SealedWallRow[],
  opts: { viewerId: string; keys: PrayerKeys },
): PrayerWallRow[] {
  return raws.map((raw) => {
    const { id, org_id: orgId, body_ciphertext: sealed, author_hash: hash } = raw;
    return toWallRow({
      ...raw,
      body: sealed ? decryptBody(opts.keys, orgId, id, sealed) : raw.body,
      mine: raw.mine === true || (raw.is_anonymous && !!hash && isAuthor(opts.keys, orgId, id, opts.viewerId, hash)),
    });
  });
}
