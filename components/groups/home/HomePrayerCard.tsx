"use client";

import { useState } from "react";
import { Check, HandHeart, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { savePrayerResponse } from "@/components/prayer/savePrayerResponse";
import { failureMessage } from "@/lib/errorCopy";
import { initials } from "@/lib/names";
import { prayerAuthorLabel } from "@/lib/prayer";
import type { PrayerWallRow } from "@/lib/types";

/** Home's one prayer request. "I'm praying" stays secondary even once chosen: Clay is kept for the serving ask and the join panel. */
export function HomePrayerCard({
  request,
  userId,
  groupId,
}: {
  request: PrayerWallRow;
  userId: string;
  groupId: string;
}) {
  const [praying, setPraying] = useState(false);
  const [saving, setSaving] = useState(false);
  const hasName = request.first_name || request.last_name || request.preferred_name;
  const showInitials = !request.is_anonymous && hasName;

  const toggle = async () => {
    const next = !praying;
    setPraying(next);
    setSaving(true);
    const { error } = await savePrayerResponse({
      requestId: request.id,
      profileId: userId,
      groupId,
      praying: next,
    });
    if (error) {
      setPraying(!next);
      toast.error(failureMessage("save that"));
    }
    setSaving(false);
  };

  return (
    <div className="flex gap-3 rounded-2xl border border-border bg-card p-4">
      {showInitials ? (
        <Avatar size="lg" className="shrink-0">
          <AvatarFallback className="bg-brand-warm font-semibold text-brand-primary-text">
            {initials(request)}
          </AvatarFallback>
        </Avatar>
      ) : (
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-warm text-brand-primary-text">
          <UserRound className="h-5 w-5" aria-hidden="true" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="font-sans text-lg font-semibold text-foreground">{prayerAuthorLabel(request)}</p>
        <p className="line-clamp-3 font-sans text-base text-foreground">{request.body}</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button variant="secondary" onClick={toggle} disabled={saving} aria-pressed={praying}>
            {praying ? <Check aria-hidden="true" /> : <HandHeart aria-hidden="true" />}
            {praying ? "You're praying" : "I'm praying"}
          </Button>
          <span className="font-sans text-base text-muted-foreground" aria-live="polite">
            <strong className="font-semibold text-foreground">
              {request.praying_count + (praying ? 1 : 0)}
            </strong>{" "}
            praying
          </span>
        </div>
      </div>
    </div>
  );
}
