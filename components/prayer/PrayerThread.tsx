"use client";

import { useState } from "react";
import { MessageCircle, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PrayerCommentForm } from "@/components/prayer/PrayerCommentForm";
import { prayerAuthorLabel, timeAgo } from "@/lib/prayer";
import type { NewPrayerComment, PrayerCommentView } from "@/lib/prayer/comments";
import type { PrayerWallRow } from "@/lib/types";

/** A hidden-name comment shows Anonymous to everyone, its writer included; they also see the You badge. */
export function commentWriterLabel(comment: PrayerCommentView): string {
  return prayerAuthorLabel({ ...comment, is_anonymous: comment.hide_name });
}

/** Who a private comment reaches, named only when the request is by name. */
export function askerLabel(row: PrayerWallRow): string {
  const label = prayerAuthorLabel(row);
  return row.is_anonymous || label === "A member" ? "the person who asked" : label;
}

export function PrayerThread({
  row,
  comments,
  onComment,
  onDeleteComment,
  timeZone,
}: {
  row: PrayerWallRow;
  /** Null when the comments couldn't be read: none are shown and none can be added. */
  comments: PrayerCommentView[] | null;
  onComment: (draft: NewPrayerComment) => Promise<boolean>;
  onDeleteComment: (comment: PrayerCommentView) => void;
  timeZone: string;
}) {
  const [writing, setWriting] = useState(false);

  if (comments === null) {
    return <p className="mt-4 border-t border-border pt-3 text-base text-muted-foreground">Comments couldn&apos;t load.</p>;
  }

  return (
    <section aria-label="Comments" className="mt-4 border-t border-border pt-3">
      {comments.length > 0 && (
        <ul className="space-y-3">
          {comments.map((c) => (
            <li key={c.id} className="rounded-xl bg-background p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-base font-semibold text-foreground">{commentWriterLabel(c)}</span>
                {c.mine && <Badge variant="secondary">You</Badge>}
                {c.only_asker && <Badge variant="outline">Private</Badge>}
                <span className="text-sm text-muted-foreground">{timeAgo(c.created_at, timeZone)}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-base leading-relaxed text-foreground">{c.body}</p>
              {c.can_delete && (
                <div className="mt-2 flex justify-end">
                  <Button variant="outline" size="sm" onClick={() => onDeleteComment(c)}>
                    <Trash2 aria-hidden="true" />
                    Delete
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {writing ? (
        <PrayerCommentForm
          askerLabel={askerLabel(row)}
          ownRequest={row.mine}
          onPost={async (draft) => {
            const ok = await onComment(draft);
            if (ok) setWriting(false);
            return ok;
          }}
          onCancel={() => setWriting(false)}
        />
      ) : (
        <Button variant="secondary" className={comments.length > 0 ? "mt-3" : undefined} onClick={() => setWriting(true)}>
          <MessageCircle aria-hidden="true" />
          Comment
        </Button>
      )}
    </section>
  );
}
