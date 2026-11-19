"use client";

import { useState } from "react";
import { HandHeart, UserRound } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { Me } from "@/components/prayer/PrayerBoard";
import { SwitchRow } from "@/components/prayer/SwitchRow";
import { REQUEST_TEXT_MAX, type NewPrayerRequest } from "@/lib/prayer/requests";

export function PrayerComposer({
  me,
  groupName,
  onPost,
}: {
  me: Me;
  groupName: string;
  onPost: (draft: NewPrayerRequest) => Promise<boolean>;
}) {
  const [body, setBody] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const canPost = body.trim().length > 0 && !submitting;

  const submit = async () => {
    if (!canPost) return;
    setSubmitting(true);
    let ok = false;
    try {
      ok = await onPost({ body: body.trim(), is_anonymous: anonymous });
    } finally {
      setSubmitting(false);
    }
    if (ok) {
      setBody("");
      setAnonymous(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="p-5 pb-0">
        <div className="mb-3.5 flex items-center gap-2.5">
          <Avatar
            size="lg"
            className={`shrink-0 transition-opacity ${anonymous ? "opacity-25" : ""}`}
          >
            {me.avatarUrl && <AvatarImage src={me.avatarUrl} alt="" />}
            <AvatarFallback className="bg-brand-bg-light font-bold text-foreground">
              {me.initials}
            </AvatarFallback>
          </Avatar>
          <h2 id="prayer-composer-title" className="text-xl font-semibold text-foreground">
            Share a request
          </h2>
        </div>

        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="What can we pray with you about?"
          rows={4}
          maxLength={REQUEST_TEXT_MAX}
          aria-labelledby="prayer-composer-title"
          className="bg-background text-base"
        />
      </div>

      <div className="flex flex-col gap-2 p-5">
        <SwitchRow
          id="prayer-anonymous"
          on={anonymous}
          onToggle={setAnonymous}
          title="Share anonymously"
          sub="Your name is hidden — only the request is shown."
          icon={<UserRound className="h-4 w-4" aria-hidden="true" />}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-background px-5 py-3.5">
        <p className="text-base text-muted-foreground">
          Posting to{" "}
          <strong className="font-semibold text-foreground">{groupName}</strong>{" "}
          as{" "}
          <strong className="font-semibold text-foreground">
            {anonymous ? "Anonymous" : me.name}
          </strong>
        </p>
        <Button type="button" onClick={submit} disabled={!canPost} className="font-semibold">
          <HandHeart aria-hidden="true" />
          {submitting ? "Posting…" : "Post request"}
        </Button>
      </div>
    </div>
  );
}
