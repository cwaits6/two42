"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { recordUsage } from "@/lib/analytics/recordUsage";

/**
 * Counts a page view once the page is on screen. A prefetch never mounts it,
 * and a refresh of the same address does not change the pathname.
 */
export function UsageRecorder() {
  const pathname = usePathname();
  useEffect(() => {
    void recordUsage("view", pathname);
  }, [pathname]);
  return null;
}
