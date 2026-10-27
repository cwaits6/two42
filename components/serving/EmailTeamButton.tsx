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
import { Mail } from "lucide-react";
import { formatServiceDate } from "@/lib/serving/sundays";

interface EmailTeamButtonProps {
  groupId: string;
  teamName: string;
  openDates: string[];
  memberCount: number;
}

/**
 * Leader broadcast: previews the open Sundays the email will list, then sends
 * every team member a message with one-tap signup links.
 */
export function EmailTeamButton({
  groupId,
  teamName,
  openDates,
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
        body: JSON.stringify({ groupId, message: message.trim() || undefined }),
      });

      if (res.ok) {
        const data = await res.json();
        toast.success(`Email sent to ${data.sent} team member${data.sent !== 1 ? "s" : ""}.`);
        setOpen(false);
        setMessage("");
        router.refresh();
      } else {
        const body = await res.json().catch(() => null);
        toast.error(body?.error || "Failed to send — please try again.");
      }
    } catch {
      toast.error("Failed to send — please try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        disabled={openDates.length === 0}
      >
        <Mail className="mr-2 h-4 w-4" />
        Email the team
      </Button>

      <Dialog open={open} onOpenChange={(o) => !sending && setOpen(o)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Email the {teamName}</DialogTitle>
          </DialogHeader>

          {memberCount === 0 ? (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
              No team members found. Add members to this group in{" "}
              <strong>Admin → Groups</strong> first.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Everyone on the team ({memberCount} member{memberCount !== 1 ? "s" : ""})
              will get an email listing the open dates below, each with a
              one-tap signup button.
            </p>
          )}

          <ul className="text-sm list-disc pl-5 space-y-0.5 max-h-40 overflow-y-auto">
            {openDates.map((d) => (
              <li key={d}>{formatServiceDate(d)}</li>
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
              className="bg-brand-primary hover:bg-brand-primary/90 text-white"
            >
              {sending ? "Sending..." : `Send to ${memberCount} member${memberCount !== 1 ? "s" : ""}`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
