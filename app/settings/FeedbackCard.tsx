"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Send } from "lucide-react";
import { toast } from "sonner";
import { Segmented } from "@/components/ui/segmented";

type FeedbackType = "idea" | "problem";

const TYPE_OPTIONS: { value: FeedbackType; label: string }[] = [
  { value: "idea", label: "An idea" },
  { value: "problem", label: "Something's broken" },
];

export function FeedbackCard() {
  const [type, setType] = useState<FeedbackType>("idea");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = message.trim();
    if (!trimmed) {
      toast.error("Please write a short note first.");
      return;
    }

    setSending(true);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, message: trimmed }),
      });

      if (!res.ok) {
        toast.error("Failed to send your feedback. Please try again.");
        return;
      }

      setMessage("");
      toast.success("Thank you — your feedback has been sent.");
    } catch {
      toast.error("Failed to send your feedback. Please try again.");
    } finally {
      setSending(false);
    }
  };

  return (
    <Card>
      <CardContent className="pt-6">
        <h3 className="mb-2">Feedback</h3>
        <p className="mb-5 text-muted-foreground">
          Spotted a problem, or have an idea to make the app better? Tell us
          here.
        </p>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label className="text-base">What kind of feedback is this?</Label>
            <div>
              <Segmented
                label="Feedback type"
                options={TYPE_OPTIONS}
                value={type}
                onChange={setType}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="feedback-message" className="text-base">
              Tell us what happened, or what you&apos;d like
            </Label>
            <Textarea
              id="feedback-message"
              rows={3}
              maxLength={2000}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="text-base"
            />
          </div>

          <Button type="submit" disabled={sending || !message.trim()}>
            <Send className="mr-2 h-4 w-4" />
            {sending ? "Sending..." : "Send my feedback"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
