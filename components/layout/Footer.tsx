import Link from "next/link";
import { siteConfig } from "@/lib/config";
import { resolveOrgSlug } from "@/lib/org";
import { Heart } from "lucide-react";

export function Footer() {
  return (
    <footer className="bg-brand-primary">
      <div className="container mx-auto px-4 py-12">
        <div className="grid md:grid-cols-3 gap-10 mb-10">
          {/* Brand */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center">
                <span className="text-white font-bold text-base font-display">{siteConfig.logoMonogram}</span>
              </div>
              <span className="text-2xl font-bold font-display text-white">{siteConfig.name}</span>
            </div>
            <p className="text-white/70 text-base leading-relaxed">
              {siteConfig.description}
            </p>
          </div>

          {/* Quick links */}
          <div>
            <h4 className="text-white font-bold text-lg mb-4 font-display">Quick Links</h4>
            <ul className="space-y-2">
              {[
                { href: "/events", label: "Calendar" },
                { href: "/lectures", label: "Lecture Library" },
                { href: `/${resolveOrgSlug()}/join`, label: "Join Our Group" },
                { href: "/login", label: "Member Sign In" },
              ].map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-white/60 hover:text-white transition-colors text-base"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Tagline / verse */}
          <div>
            <h4 className="text-white font-bold text-lg mb-4 font-display">Our Mission</h4>
            <p className="text-white/70 text-base leading-relaxed">
              {siteConfig.tagline}
            </p>
          </div>
        </div>

        <div className="border-t border-white/10 pt-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-white/60 text-base">
            &copy; {new Date().getFullYear()} {siteConfig.name}
          </p>
          <p className="text-white/50 text-sm flex items-center gap-1">
            Made with <Heart className="h-3.5 w-3.5 text-brand-accent fill-brand-accent" /> for our community
          </p>
        </div>
      </div>
    </footer>
  );
}
