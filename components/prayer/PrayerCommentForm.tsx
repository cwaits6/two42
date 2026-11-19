"use client";

import { useId, useState } from "react";
import { EyeOff, Lock, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SwitchRow } from "@/components/prayer/SwitchRow";
import { COMMENT_TEXT_MAX, type NewPrayerComment } from "@/lib/prayer/comments";

const COMMENT_NEAR_LIMIT = 50;

export function PrayerCommentForm({
  askerLabel,
  ownRequest,
  ownAnonymousRequest,
  onPost,
  onCancel,
}: {
  /** Who "only the person who asked" means on this request, as the viewer may see it. */
  askerLabel: string;
  /** A private comment on the viewer's own request would reach no one else, so the choice is not offered. */
  ownRequest: boolean;
  /** The viewer asked anonymously: a named reply would reveal who asked, so the name starts hidden. */
  ownAnonymousRequest: boolean;
  onPost: (draft: NewPrayerComment) => Promise<boolean>;
  onCancel: () => void;
}) {
  const id = useId();
  const [body, setBody] = useState("");
  const [onlyAsker, setOnlyAsker] = useState(false);
  const [hideName, setHideName] = useState(ownAnonymousRequest);
  const [submitting, setSubmitting] = useState(false);

  const canPost = body.trim().length > 0 && !submitting;
  const left = COMMENT_TEXT_MAX - body.length;

  const submit = async () => {
    if (!canPost) return;
    setSubmitting(true);
    let ok = false;
    try {
      ok = await onPost({ body: body.trim(), only_asker: !ownRequest && onlyAsker, hide_name: hideName });
    } finally {
      setSubmitting(false);
    }
    if (ok) {
      setBody("");
      setOnlyAsker(false);
      setHideName(ownAnonymousRequest);
    }
  };

  return (
    <div className="mt-3 space-y-2">
      <label htmlFor={`${id}-text`} className="block text-base font-semibold text-foreground">
        Add a comment
      </label>
      <Textarea
        id={`${id}-text`}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        readOnly={submitting}
        maxLength={COMMENT_TEXT_MAX}
        className="bg-background text-base"
        aria-describedby={left <= COMMENT_NEAR_LIMIT ? `${id}-left` : undefined}
      />
      {left <= COMMENT_NEAR_LIMIT && (
        <p id={`${id}-left`} className="text-sm text-muted-foreground">
          {left === 1 ? "1 character left" : `${left} characters left`}
        </p>
      )}
      {!ownRequest && (
        <SwitchRow
          id={`${id}-only-asker`}
          on={onlyAsker}
          onToggle={setOnlyAsker}
          disabled={submitting}
          title={`Only ${askerLabel} can see this`}
          sub="Others in the group won't see your comment."
          icon={<Lock className="h-4 w-4" aria-hidden="true" />}
        />
      )}
      <SwitchRow
        id={`${id}-hide-name`}
        on={hideName}
        onToggle={setHideName}
        disabled={submitting}
        title="Hide my name"
        sub={
          ownAnonymousRequest
            ? "Your request is anonymous. Turn this off and your name shows on this comment."
            : "Your comment shows as Anonymous to everyone."
        }
        icon={<EyeOff className="h-4 w-4" aria-hidden="true" />}
      />
      <div className="flex flex-wrap justify-end gap-2 pt-1">
        {/* A post that lands after Cancel would close a newer draft, so the form holds still until it returns. */}
        <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button type="button" onClick={submit} disabled={!canPost} className="font-semibold">
          <MessageCircle aria-hidden="true" />
          {submitting ? "Posting…" : "Post comment"}
        </Button>
      </div>
    </div>
  );
}
