"use client";

import { useState } from "react";
import { Rss } from "lucide-react";
import { Button } from "@/components/ui/button";
import { failureMessage } from "@/lib/errorCopy";
import { toast } from "sonner";

interface SubscribeToEventButtonProps {
  eventId: string;
}

export function SubscribeToEventButton({ eventId }: SubscribeToEventButtonProps) {
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/calendar/subscription-token", { method: "POST" });
      if (!res.ok) {
        toast.error(failureMessage("create your calendar link", res.status));
        return;
      }
      const { token } = (await res.json()) as { token: string };
      toast.info("This replaces your earlier calendar link, and the earlier link stops working.");
      window.location.href = `webcal://${window.location.host}/api/events/${eventId}/ics?token=${token}`;
    } catch {
      toast.error(failureMessage("create your calendar link", "network"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button onClick={handleClick} disabled={loading} variant="outline">
      <Rss aria-hidden="true" />
      {loading ? "Preparing…" : "Subscribe"}
    </Button>
  );
}
