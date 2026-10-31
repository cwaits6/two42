"use client";

import type { ReactNode } from "react";
import { useDirectory } from "@/components/directory/DirectoryContext";
import { ErrorState } from "@/components/states/ErrorState";
import { LoadingState } from "@/components/states/LoadingState";

/** Skeleton while loading, a retry when the load failed, else the tab body. */
export function DirectoryLoadState({ children }: { children: ReactNode }) {
  const { loading, error, reload } = useDirectory();
  if (loading) return <LoadingState thing="the directory" />;
  if (error) return <ErrorState thing="the directory" onRetry={reload} />;
  return <>{children}</>;
}
