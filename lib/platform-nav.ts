import type { ComponentType } from "react";
import { Building2, LayoutDashboard } from "lucide-react";

export interface PlatformNavItem {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** Match the pathname exactly instead of by prefix. */
  exact?: boolean;
}

/**
 * Single source of truth for platform-operator destinations and labels —
 * shared by the /platform area's sub-nav and any other platform nav surface.
 */
export const platformNavItems: PlatformNavItem[] = [
  { href: "/platform", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/platform/organizations", label: "Organizations", icon: Building2 },
];
