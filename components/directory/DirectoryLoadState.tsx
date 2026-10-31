"use client";

import type { ReactNode } from "react";
import { useDirectory } from "@/components/directory/DirectoryContext";
import { RetryErrorState } from "@/components/directory/RetryErrorState";
import { LoadingState } from "@/components/states/LoadingState";

/** Skeleton while loading, a retry when the load failed, else the tab body. */
export function DirectoryLoadState({ children }: { children: ReactNode }) {
  const { loading, error, reload } = useDirectory();
  if (loading) return <LoadingState thing="the directory" />;
  if (error) return <RetryErrorState thing="the directory" onRetry={reload} />;
  return <>{children}</>;
}
