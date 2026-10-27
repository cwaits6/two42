"use client";

import { Button } from "@/components/ui/button";
import { useRsvp } from "@/components/events/useRsvp";
import { Check, X, HelpCircle } from "lucide-react";
import type { RsvpStatus } from "@/lib/types";

interface RsvpButtonProps {
  eventId: string;
  userId: string;
  currentStatus: RsvpStatus | null;
}

export function RsvpButton({ eventId, userId, currentStatus }: RsvpButtonProps) {
  const { status, saving, error, choose } = useRsvp({
    eventId,
    userId,
    initialStatus: currentStatus,
  });

  const options: { value: RsvpStatus; label: string; icon: React.ReactNode }[] = [
    { value: "yes", label: "Going", icon: <Check className="h-5 w-5" /> },
    { value: "maybe", label: "Maybe", icon: <HelpCircle className="h-5 w-5" /> },
    { value: "no", label: "Can't Go", icon: <X className="h-5 w-5" /> },
  ];

  return (
    <div className="pt-3">
      <div className="flex flex-wrap gap-3">
        {options.map((option) => (
          <Button
            key={option.value}
            variant={status === option.value ? "default" : "outline"}
            size="lg"
            className={`gap-2 px-4 text-base ${status === option.value ? "" : "text-slate-700 hover:border-brand-primary/30 hover:text-brand-primary-text"}`}
            onClick={() => choose(option.value)}
            disabled={saving}
            aria-pressed={status === option.value}
          >
            {option.icon}
            <span>{option.label}</span>
          </Button>
        ))}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-base text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
