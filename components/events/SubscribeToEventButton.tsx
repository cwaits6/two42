"use client";

import { useState } from "react";
import { Rss } from "lucide-react";
import { Button } from "@/components/ui/button";
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
        toast.error("Couldn't create your calendar link. Please try again.");
        return;
      }
      const { token } = (await res.json()) as { token: string };
      toast.info("This replaces any earlier calendar link — older links stop working.");
      window.location.href = `webcal://${window.location.host}/api/events/${eventId}/ics?token=${token}`;
    } catch {
      toast.error("Couldn't create your calendar link. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      onClick={handleClick}
      disabled={loading}
      variant="outline"
      size="lg"
      className="h-10 gap-2 border-slate-200 bg-white px-6 text-base text-slate-600 shadow-sm hover:border-brand-primary/30 hover:bg-white hover:text-brand-primary-text"
    >
      <Rss className="h-4 w-4" />
      {loading ? "Preparing…" : "Subscribe to Event"}
    </Button>
  );
}
