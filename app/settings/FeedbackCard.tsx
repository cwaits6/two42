"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FieldError, invalidFieldProps } from "@/components/ui/field-error";
import { Send } from "lucide-react";
import { toast } from "sonner";
import { failureMessage } from "@/lib/errorCopy";
import { Segmented } from "@/components/ui/segmented";

type FeedbackType = "idea" | "problem";

const TYPE_OPTIONS: { value: FeedbackType; label: string }[] = [
  { value: "idea", label: "An idea" },
  { value: "problem", label: "Something's broken" },
];

export function FeedbackCard() {
  const [type, setType] = useState<FeedbackType>("idea");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [sending, setSending] = useState(false);
  // An object, so a second empty submit still refocuses.
  const [focusRequest, setFocusRequest] = useState<object | null>(null);

  // Focus waits for the render that ties the message to the field.
  useEffect(() => {
    if (focusRequest) document.getElementById("feedback-message")?.focus();
  }, [focusRequest]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = message.trim();
    if (!trimmed) {
      setError("Enter your feedback.");
      setFocusRequest({});
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
        toast.error(failureMessage("send your feedback", res.status));
        return;
      }

      setMessage("");
      toast.success("Feedback sent.");
    } catch {
      toast.error(failureMessage("send your feedback", "network"));
    } finally {
      setSending(false);
    }
  };

  return (
    <Card>
      <CardContent className="pt-6">
        <h2 className="mb-2 text-2xl">Feedback</h2>
        <p className="mb-5 text-base text-muted-foreground">
          Spotted a problem, or have an idea to make the app better? Tell us
          here.
        </p>

        <form onSubmit={handleSubmit} noValidate className="space-y-5">
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
              onChange={(e) => {
                setMessage(e.target.value);
                setError(undefined);
              }}
              className="text-base"
              {...invalidFieldProps("feedback-message", error)}
            />
            <FieldError fieldId="feedback-message" message={error} />
          </div>

          <Button type="submit" disabled={sending}>
            <Send className="mr-2 h-5 w-5" aria-hidden="true" />
            {sending ? "Sending…" : "Send feedback"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
