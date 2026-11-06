import { CONTACT_EMAIL } from "@/components/landing/sections";

/** Help, Privacy and Terms: in the account menu and on Settings, where a signed-in person has no footer. */
export const INFO_LINKS = [
  { href: `mailto:${CONTACT_EMAIL}`, label: "Help" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
] as const;
