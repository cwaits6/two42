"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useDirectory } from "@/components/directory/DirectoryContext";
import { DirectoryListSkeleton } from "@/components/directory/DirectoryListSkeleton";

/** Skeleton while loading, a retry when the load failed, else the tab body. */
export function DirectoryLoadState({ children }: { children: ReactNode }) {
  const { loading, error, reload } = useDirectory();
  if (loading) return <DirectoryListSkeleton />;
  if (error) {
    return (
      <div className="rounded-xl border border-border p-8 text-center">
        <p className="text-base text-muted-foreground">The directory could not be loaded.</p>
        <Button variant="outline" className="mt-4" onClick={reload}>
          Try again
        </Button>
      </div>
    );
  }
  return <>{children}</>;
}
