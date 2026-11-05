"use client";

import { usePathname } from "next/navigation";
import { Analytics } from "@vercel/analytics/react";
import { pagePattern, patternOnly } from "@/lib/analytics/pagePattern";

/**
 * Page views, reported by route pattern only. The framework-specific entry of
 * the package passes the real pathname, so this drives the plain one and
 * supplies the pattern itself; a null route turns the script's own tracking
 * off, so an address with no pattern sends nothing.
 */
export function PageMeasurement() {
  const pathname = usePathname();
  const pattern = pagePattern(pathname);

  return (
    <Analytics
      // Remounts per address: two pages sharing a pattern would otherwise count as one view.
      key={pathname}
      framework="next"
      basePath={process.env.NEXT_PUBLIC_VERCEL_OBSERVABILITY_BASEPATH}
      configString={process.env.NEXT_PUBLIC_VERCEL_OBSERVABILITY_CLIENT_CONFIG}
      route={pattern}
      path={pattern}
      beforeSend={patternOnly}
    />
  );
}
