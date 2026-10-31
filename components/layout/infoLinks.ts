import { CONTACT_EMAIL } from "@/components/landing/sections";

/** Privacy, Terms and Help: in the account menu and on Settings, where a signed-in person has no footer. */
export const INFO_LINKS = [
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: `mailto:${CONTACT_EMAIL}`, label: "Help" },
] as const;
