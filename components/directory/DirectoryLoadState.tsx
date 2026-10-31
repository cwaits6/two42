"use client";

import type { ReactNode } from "react";
import { CircleAlert, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDirectory } from "@/components/directory/DirectoryContext";
import { LoadingState } from "@/components/states/LoadingState";

/** Skeleton while loading, a retry when the load failed, else the tab body. */
export function DirectoryLoadState({ children }: { children: ReactNode }) {
  const { loading, error, reload } = useDirectory();
  if (loading) return <LoadingState thing="the directory" />;
  // ErrorState's Try again re-runs server reads; the directory loads in the
  // browser, so this keeps its look and copy and retries the client read.
  if (error) {
    return (
      <div
        role="alert"
        className="flex flex-col items-center rounded-2xl border border-destructive/30 bg-card px-6 py-12 text-center"
      >
        <CircleAlert className="mb-4 h-8 w-8 text-destructive" aria-hidden="true" />
        <p className="text-xl font-medium text-foreground">Couldn&apos;t load the directory.</p>
        <Button variant="outline" className="mt-6" onClick={reload}>
          <RotateCw aria-hidden="true" />
          Try again
        </Button>
      </div>
    );
  }
  return <>{children}</>;
}
