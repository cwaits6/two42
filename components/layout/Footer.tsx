import Link from "next/link";
import { CONTACT_EMAIL, GITHUB_URL, SELF_HOST_URL } from "@/components/landing/sections";

const LINKS = [
  { href: GITHUB_URL, label: "GitHub" },
  { href: SELF_HOST_URL, label: "Self-host guide" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: `mailto:${CONTACT_EMAIL}`, label: "Contact" },
];

export function Footer() {
  return (
    <footer className="mt-auto bg-foreground text-background">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-5 px-6 py-9">
        <span className="font-serif text-[1.75rem] font-medium leading-none">
          two<span className="text-brand-accent">42</span>
        </span>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-1">
          {LINKS.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              className="inline-flex min-h-11 items-center text-base hover:text-brand-accent"
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <span className="text-base text-background/80">&copy; {new Date().getFullYear()} two42</span>
      </div>
    </footer>
  );
}
