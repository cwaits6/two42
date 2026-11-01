"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { failureMessage } from "@/lib/errorCopy";
import { Mail } from "lucide-react";
import { formatServingDate } from "@/lib/serving/dates";

interface EmailTeamButtonProps {
  teamId: string;
  teamName: string;
  openDates: string[];
  /** Today in the church's time zone, "YYYY-MM-DD" */
  today: string;
  memberCount: number;
}

/**
 * Leader broadcast: previews the open dates the email will list, then sends
 * every team member a message with one-tap signup links.
 */
export function EmailTeamButton({
  teamId,
  teamName,
  openDates,
  today,
  memberCount,
}: EmailTeamButtonProps) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const router = useRouter();

  async function send() {
    setSending(true);
    try {
      const res = await fetch("/api/serving/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId: teamId, message: message.trim() || undefined }),
      });

      if (res.ok) {
        const data = await res.json();
        toast.success(`Email sent to ${data.sent} team member${data.sent !== 1 ? "s" : ""}.`);
        setOpen(false);
        setMessage("");
        router.refresh();
      } else {
        toast.error(failureMessage("email the team", res.status));
      }
    } catch {
      toast.error(failureMessage("email the team", "network"));
    } finally {
      setSending(false);
    }
  }

  const allCovered = openDates.length === 0;

  return (
    <div className="flex flex-col gap-1">
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        disabled={allCovered}
        aria-describedby={allCovered ? "email-team-reason" : undefined}
      >
        <Mail aria-hidden="true" />
        Email the team
      </Button>
      {allCovered && (
        <p id="email-team-reason" className="text-base text-muted-foreground">
          Every date is covered.
        </p>
      )}

      <Dialog open={open} onOpenChange={(o) => !sending && setOpen(o)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Email {teamName}</DialogTitle>
          </DialogHeader>

          {memberCount === 0 ? (
            <p className="text-base text-foreground bg-muted border border-border rounded-md px-3 py-2">
              No one on this team can get email yet. Add people under Team
              members on this page first.
            </p>
          ) : (
            <p className="text-base text-muted-foreground">
              Everyone on the team ({memberCount} member{memberCount !== 1 ? "s" : ""})
              will get an email listing the open dates below, each with a
              one-tap signup button.
            </p>
          )}

          <ul className="text-base list-disc pl-5 space-y-0.5 max-h-40 overflow-y-auto">
            {openDates.map((d) => (
              <li key={d}>{formatServingDate(d, today)}</li>
            ))}
          </ul>

          <div className="space-y-2">
            <Label htmlFor="broadcast-message">
              Add a personal note (optional)
            </Label>
            <Textarea
              id="broadcast-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={1000}
              placeholder="e.g. We especially need help the last two weeks of the month."
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="ghost"
              disabled={sending}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              disabled={sending || memberCount === 0}
              onClick={send}
            >
              {sending ? "Sending…" : `Send to ${memberCount} member${memberCount !== 1 ? "s" : ""}`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
