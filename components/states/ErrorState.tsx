"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ErrorStateProps {
  /** What failed to load, as it finishes "Couldn't load …", e.g. "announcements" */
  thing: string;
  className?: string;
}

/** A read that failed. Try again re-runs the page's server reads. */
export function ErrorState({ thing, className }: ErrorStateProps) {
  const router = useRouter();
  const [retrying, startRetry] = useTransition();

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
      <Button
        variant="outline"
        className="mt-6"
        disabled={retrying}
        onClick={() => startRetry(() => router.refresh())}
      >
        <RotateCw aria-hidden="true" />
        Try again
      </Button>
    </div>
  );
}
