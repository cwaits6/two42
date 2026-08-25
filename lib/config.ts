import { normalizeHost } from "@/lib/org";

export const siteConfig = {
  name: process.env.NEXT_PUBLIC_APP_NAME || "two42",
  description:
    process.env.NEXT_PUBLIC_APP_DESCRIPTION ||
    "A welcoming community of faith, growing together in God's Word.",
  tagline:
    process.env.NEXT_PUBLIC_APP_TAGLINE ||
    "To be the body of Christ through fellowship, discipleship and the faithful study of the Word of God.",
  logoMonogram: process.env.NEXT_PUBLIC_LOGO_MONOGRAM || "42",
  url: process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
  // Platform apex for host → org resolution (Phase 5 PR 3, CWA-67 / #360;
  // decision D6): subdomains are <org-slug>.<apex>. Normalized like every
  // other host value classifyHost() compares against it — an un-normalized
  // env value (mixed case, trailing dot, padding) would otherwise
  // misclassify every real subdomain as a custom-domain candidate.
  platformApex: normalizeHost(process.env.NEXT_PUBLIC_PLATFORM_APEX || "two42.io"),
  email: {
    from:
      process.env.NEXT_PUBLIC_EMAIL_FROM ||
      "two42 <noreply@incouragers.org>",
  },
  colors: {
    primary: process.env.NEXT_PUBLIC_COLOR_PRIMARY || "#B85C38",
    primaryLight: process.env.NEXT_PUBLIC_COLOR_PRIMARY_LIGHT || "#C97A54",
    accent: process.env.NEXT_PUBLIC_COLOR_ACCENT || "#E8A33D",
    warm: process.env.NEXT_PUBLIC_COLOR_WARM || "#F3E7D9",
    backgroundLight: process.env.NEXT_PUBLIC_COLOR_BG_LIGHT || "#FAEBC2",
    backgroundMuted: process.env.NEXT_PUBLIC_COLOR_BG_MUTED || "#E8DECF",
  },
};
