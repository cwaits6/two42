"use client";

import { useState, type ReactNode } from "react";
import { HandHeart, UserRound } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { PRAYER_CATEGORIES, PRAYER_CATEGORY_KEYS } from "@/lib/prayer";
import type { PrayerCategory } from "@/lib/types";
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
      className={`flex w-full cursor-pointer items-center gap-3 rounded-xl border p-3 text-left transition-colors ${
        on
          ? "border-brand-primary/40 bg-brand-warm"
          : "border-border bg-card hover:border-brand-primary/30"
      }`}
    >
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
          on
            ? "bg-brand-primary text-white"
            : "bg-background text-muted-foreground"
        }`}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-foreground">
          {title}
        </span>
        <span className="block text-[13px] leading-snug text-muted-foreground">
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
  onPost: (draft: {
    body: string;
    category: PrayerCategory;
    is_anonymous: boolean;
  }) => Promise<boolean>;
}) {
  const [body, setBody] = useState("");
  const [category, setCategory] = useState<PrayerCategory>("health");
  const [anonymous, setAnonymous] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const canPost = body.trim().length > 0 && !submitting;

  const submit = async () => {
    if (!canPost) return;
    setSubmitting(true);
    let ok = false;
    try {
      ok = await onPost({
        body: body.trim(),
        category,
        is_anonymous: anonymous,
      });
    } finally {
      setSubmitting(false);
    }
    if (ok) {
      setBody("");
      setAnonymous(false);
      setCategory("health");
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
          <h2 className="text-xl font-semibold text-foreground">
            Share a request
          </h2>
        </div>

        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="What can we pray with you about?"
          rows={4}
          maxLength={2000}
          className="bg-background text-base"
        />

        <div className="mt-4 mb-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
          Category
        </div>
        <div className="flex flex-wrap gap-1.5">
          {PRAYER_CATEGORY_KEYS.map((key) => {
            const meta = PRAYER_CATEGORIES[key];
            const active = key === category;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setCategory(key)}
                aria-pressed={active}
                className="rounded-full border px-4 py-3 text-base font-semibold transition-colors"
                style={
                  active
                    ? { backgroundColor: meta.color, borderColor: meta.color, color: "var(--primary-foreground)" }
                    : undefined
                }
              >
                {meta.label}
              </button>
            );
          })}
        </div>
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
        <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <span>
            Posting to{" "}
            <strong className="font-semibold text-foreground">{groupName}</strong>{" "}
            as{" "}
            <strong className="font-semibold text-foreground">
              {anonymous ? "Anonymous" : me.name}
            </strong>
          </span>
        </p>
        <button
          type="button"
          onClick={submit}
          disabled={!canPost}
          className="flex items-center gap-2 rounded-lg bg-brand-primary px-4 py-2.5 text-sm font-bold text-white transition-opacity disabled:opacity-40"
        >
          <HandHeart className="h-4 w-4" aria-hidden="true" />
          {submitting ? "Posting…" : "Post request"}
        </button>
      </div>
    </div>
  );
}
