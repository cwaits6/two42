"use client";

import { Check, HandHeart, UserRound } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { initials } from "@/lib/names";
import { prayerAuthorLabel, timeAgo } from "@/lib/prayer";
import { cn } from "@/lib/utils";
import type { PrayerWallRow } from "@/lib/types";

export function PrayerCard({
  row,
  prayPending,
  onPray,
  onToggleAnswered,
  timeZone,
}: {
  row: PrayerWallRow;
  prayPending: boolean;
  onPray: () => void;
  onToggleAnswered: () => void;
  /** The church's zone; older requests show the date there. */
  timeZone: string;
}) {
  const hasName = row.first_name || row.last_name || row.preferred_name;
  const showAvatar = !row.is_anonymous && hasName;

  return (
    <article
      className={cn(
        "relative overflow-hidden rounded-2xl border bg-card p-5",
        row.is_answered ? "border-brand-success/40" : "border-border",
      )}
    >
      {row.is_answered && (
        <div aria-hidden="true" className="absolute inset-y-0 left-0 w-1 bg-brand-success" />
      )}

      <div className="flex items-center gap-3">
        {showAvatar ? (
          <Avatar size="lg" className="shrink-0">
            {row.avatar_url && <AvatarImage src={row.avatar_url} alt="" />}
            <AvatarFallback className="bg-brand-warm font-semibold text-brand-primary-text">
              {initials(row)}
            </AvatarFallback>
          </Avatar>
        ) : (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-dashed border-muted-foreground/40 bg-background text-muted-foreground">
            <UserRound className="h-5 w-5" aria-hidden="true" />
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-semibold text-foreground">{prayerAuthorLabel(row)}</span>
            {row.mine && <Badge variant="secondary">You</Badge>}
            {row.is_answered && (
              <Badge variant="outline">
                <Check className="text-brand-success" aria-hidden="true" />
                Answered
              </Badge>
            )}
          </div>
          <div className="text-sm text-muted-foreground">{timeAgo(row.created_at, timeZone)}</div>
        </div>
      </div>

      <p className="mt-3 whitespace-pre-wrap text-base leading-relaxed text-foreground">{row.body}</p>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={row.i_am_praying ? "default" : "secondary"}
            onClick={onPray}
            disabled={prayPending}
            aria-pressed={row.i_am_praying}
          >
            <HandHeart aria-hidden="true" />
            {row.i_am_praying ? "You're praying" : "I'm praying"}
          </Button>

          {row.mine && (
            <Button variant="outline" onClick={onToggleAnswered} aria-pressed={row.is_answered}>
              <Check aria-hidden="true" />
              {row.is_answered ? "Answered" : "Mark answered"}
            </Button>
          )}
        </div>
        <span className="text-base text-muted-foreground">
          <strong className="font-semibold text-foreground">{row.praying_count}</strong> praying
        </span>
      </div>
    </article>
  );
}
