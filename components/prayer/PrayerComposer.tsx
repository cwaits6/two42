"use client";

import { useState, type ReactNode } from "react";
import { HandHeart, UserRound } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { Me } from "@/components/prayer/PrayerBoard";

function SwitchRow({
  id,
  on,
  onToggle,
  title,
  sub,
  icon,
}: {
  id: string;
  on: boolean;
  onToggle: (checked: boolean) => void;
  title: string;
  sub: string;
  icon: ReactNode;
}) {
  return (
    <label
      htmlFor={id}
      className={`flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-xl border p-3 text-left transition-colors ${
        on
          ? "border-brand-primary/40 bg-brand-warm"
          : "border-border bg-card hover:border-brand-primary/30"
      }`}
    >
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
          on
            ? "bg-primary text-primary-foreground"
            : "bg-background text-muted-foreground"
        }`}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-base font-semibold text-foreground">
          {title}
        </span>
        <span className="block text-sm leading-snug text-muted-foreground">
          {sub}
        </span>
      </span>
      <Switch id={id} checked={on} onCheckedChange={onToggle} />
    </label>
  );
}

export function PrayerComposer({
  me,
  groupName,
  onPost,
}: {
  me: Me;
  groupName: string;
  onPost: (draft: { body: string; is_anonymous: boolean }) => Promise<boolean>;
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
          maxLength={2000}
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
