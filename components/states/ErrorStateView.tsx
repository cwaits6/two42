"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { recordUsage } from "@/lib/analytics/recordUsage";

interface ErrorStateViewProps {
  thing: string;
  onRetry?: () => void;
  className?: string;
  reference: string | null;
}

export function ErrorStateView({ thing, onRetry, className, reference }: ErrorStateViewProps) {
  const router = useRouter();
  const [retrying, startRetry] = useTransition();

  useEffect(() => {
    void recordUsage("error", window.location.pathname);
  }, []);

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
        onClick={() => startRetry(onRetry ?? (() => router.refresh()))}
      >
        <RotateCw aria-hidden="true" />
        Try again
      </Button>
      {reference && (
        <p className="mt-4 text-base text-muted-foreground">
          Reference: <span className="font-mono">{reference}</span>
        </p>
      )}
    </div>
  );
}
