export const siteConfig = {
  name: process.env.NEXT_PUBLIC_APP_NAME || "two42",
  description:
    process.env.NEXT_PUBLIC_APP_DESCRIPTION ||
    "Software for a church's groups: one shared calendar, serving schedule, directory, announcements and prayer requests, with one sign-in for every member.",
  url: process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
  // Server components format dates in this zone; the server itself runs in UTC.
  timeZone: process.env.NEXT_PUBLIC_TIME_ZONE || "America/New_York",
  email: {
    from:
      process.env.NEXT_PUBLIC_EMAIL_FROM ||
      "two42 <noreply@two42.io>",
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
