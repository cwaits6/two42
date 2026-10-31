"use client";

import { CircleAlert, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface RetryErrorStateProps {
  /** What failed to load, as it finishes "Couldn't load …" */
  thing: string;
  onRetry: () => void;
  className?: string;
}

/**
 * ErrorState for a read made in the browser. ErrorState's Try again re-runs
 * server reads, which would not repeat a client read, so this takes the retry.
 */
export function RetryErrorState({ thing, onRetry, className }: RetryErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center rounded-2xl border border-destructive/30 bg-card px-6 py-12 text-center",
        className,
      )}
    >
      <CircleAlert className="mb-4 h-8 w-8 text-destructive" aria-hidden="true" />
      <p className="text-xl font-medium text-foreground">Couldn&apos;t load {thing}.</p>
      <Button variant="outline" className="mt-6" onClick={onRetry}>
        <RotateCw aria-hidden="true" />
        Try again
      </Button>
    </div>
  );
}
