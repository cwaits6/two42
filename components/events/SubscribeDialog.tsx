"use client";

import { useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type FeedLinks = {
  /** The feed itself, for pasting into any calendar app that adds a calendar by URL. */
  https: string;
  /** Opens the calendar app's subscribe prompt on a Mac or an iPhone. */
  webcal: string;
  /** Google Calendar's add-by-URL screen with the feed filled in. */
  google: string;
};

export function feedLinks(origin: string, token: string, groupId?: string): FeedLinks {
  const url = new URL("/api/calendar/feed.ics", origin);
  url.searchParams.set("token", token);
  if (groupId) url.searchParams.set("group", groupId);
  const https = url.toString();
  const webcal = https.replace(/^https?:/, "webcal:");
  return {
    https,
    webcal,
    google: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`,
  };
}

export type SubscribeState =
  | { status: "preparing" }
  | { status: "ready"; links: FeedLinks }
  | { status: "failed"; message: string };

interface SubscribeDialogProps {
  /** What the feed covers: a group's name, or "all my groups". */
  feedName: string | null;
  state: SubscribeState;
  onRetry: () => void;
  onClose: () => void;
}

const action = "h-12 w-full justify-start text-base";
const linkAction = cn(buttonVariants({ variant: "outline" }), action);

export function SubscribeDialog({ feedName, state, onRetry, onClose }: SubscribeDialogProps) {
  const [copied, setCopied] = useState<"yes" | "failed" | null>(null);
  // A copy still pending when the dialog closes must not report on the next
  // feed's dialog, whose link it did not copy.
  const session = useRef(0);

  async function copyLink(link: string) {
    const started = session.current;
    let result: "yes" | "failed";
    try {
      await navigator.clipboard.writeText(link);
      result = "yes";
    } catch {
      result = "failed";
    }
    if (session.current === started) setCopied(result);
  }

  return (
    <Dialog
      open={feedName !== null}
      onOpenChange={(open) => {
        if (open) return;
        session.current += 1;
        setCopied(null);
        onClose();
      }}
    >
      <DialogContent className="max-w-md gap-5 p-6">
        <DialogHeader>
          <DialogTitle className="font-display text-xl leading-tight">
            Subscribe to {feedName}
          </DialogTitle>
        </DialogHeader>

        {state.status === "preparing" && (
          <p role="status" className="text-base text-muted-foreground">
            Preparing your link…
          </p>
        )}

        {state.status === "failed" && (
          <>
            <p role="alert" className="text-base text-foreground">
              {state.message}
            </p>
            <Button variant="outline" className={action} onClick={onRetry}>
              Try again
            </Button>
          </>
        )}

        {state.status === "ready" && (
          <>
            <div className="grid gap-3">
              <a href={state.links.webcal} className={linkAction}>
                Open in Apple Calendar
              </a>
              <a href={state.links.google} target="_blank" rel="noopener noreferrer" className={linkAction}>
                Add to Google Calendar
              </a>
              <Button variant="outline" className={action} onClick={() => copyLink(state.links.https)}>
                {copied === "yes" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                {copied === "yes" ? "Link copied" : "Copy link"}
              </Button>
            </div>

            <div className="space-y-2">
              <p className="text-base text-muted-foreground">
                For another calendar app, copy the link and paste it where the app adds a calendar by URL.
              </p>
              <p aria-live="polite" className="text-base text-foreground">
                {copied === "yes" && <span className="sr-only">Link copied.</span>}
                {copied === "failed" && "Couldn't copy the link. Select it below and copy it."}
              </p>
              {copied === "failed" && (
                <input
                  readOnly
                  aria-label="Calendar link"
                  value={state.links.https}
                  onFocus={(e) => e.currentTarget.select()}
                  className="h-12 w-full rounded-lg border border-border bg-background px-3 text-base text-foreground"
                />
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
