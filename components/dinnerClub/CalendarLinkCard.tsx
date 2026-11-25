"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { failureMessage } from "@/lib/errorCopy";

/** The person's private dinner club calendar link: their own tables' dinners, with times and addresses. */
export function CalendarLinkCard({ hasLink }: { hasLink: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const [made, setMade] = useState(hasLink);
  const [busy, setBusy] = useState(false);
  const [resetting, setResetting] = useState(false);

  async function makeLink(): Promise<boolean> {
    setBusy(true);
    try {
      const res = await fetch("/api/dinner-club/feed-token", { method: "POST" });
      const body = (await res.json().catch(() => null)) as { token?: string } | null;
      if (!res.ok || !body?.token) {
        toast.error(failureMessage("make the link", res.status));
        return false;
      }
      setUrl(`${window.location.origin}/api/dinner-club/feed.ics?token=${body.token}`);
      setMade(true);
      return true;
    } catch {
      toast.error(failureMessage("make the link", "network"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl font-bold">Calendar link</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-lg">
          Add your dinners to your calendar app. The link is yours alone: it shows the address of each dinner, so
          don&apos;t share it. Moved dinners update on their own.
        </p>
        {url && (
          <div className="space-y-3">
            <Input readOnly value={url} aria-label="Your calendar link" className="h-12 text-base" onFocus={(e) => e.target.select()} />
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button size="lg" nativeButton={false} render={<a href={url.replace(/^https?:/, "webcal:")} />}>
                Open in calendar app
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={() =>
                  navigator.clipboard.writeText(url).then(
                    () => toast.success("Link copied."),
                    () => toast.error("Couldn't copy the link. Select it and copy it instead.")
                  )
                }
              >
                Copy link
              </Button>
            </div>
          </div>
        )}
        {!url && !made && (
          <Button size="lg" onClick={makeLink} disabled={busy}>
            {busy ? "Making link…" : "Get calendar link"}
          </Button>
        )}
        {made && (
          <Button size="lg" variant="outline" onClick={() => setResetting(true)} disabled={busy}>
            Reset link
          </Button>
        )}
        <ConfirmDialog
          open={resetting}
          onOpenChange={setResetting}
          title="Reset your calendar link?"
          description="Your old link stops working, and calendars using it lose your dinners. You'll get a new link to add."
          confirmLabel="Reset link"
          pendingLabel="Resetting…"
          onConfirm={async () => {
            if (await makeLink()) {
              setResetting(false);
              toast.success("New link made. Add it to your calendar app.");
            }
          }}
        />
      </CardContent>
    </Card>
  );
}
