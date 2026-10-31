"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { siteConfig } from "@/lib/config";
import { usePathname } from "next/navigation";
import type { Profile } from "@/lib/types";
import { isMemberRole } from "@/lib/roles";
import { AccountMenu } from "./AccountMenu";

interface HeaderProps {
  signedIn: boolean;
  profile: Profile | null;
  hasServingAccess: boolean;
  isPlatformAdmin?: boolean;
  orgName: string;
}

/** The same header for everyone signed in: the wordmark, then the menu. */
export function Header({ signedIn, profile, hasServingAccess, isPlatformAdmin = false, orgName }: HeaderProps) {
  const [scrolled, setScrolled] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 12);
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  const isMember = !!profile && isMemberRole(profile.role);

  return (
    <header
      className={`sticky top-0 z-50 w-full border-b border-border transition-all duration-300 ${
        scrolled ? "bg-background/95 backdrop-blur shadow-sm" : "bg-background"
      }`}
    >
      {/* Top accent bar */}
      <div className="h-1 w-full bg-gradient-to-r from-brand-primary-light via-brand-primary to-brand-accent" />

      <div className="flex h-16 w-full items-center justify-between px-4">
        <Link href={isMember ? "/dashboard" : "/"} className="flex items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/two42-wordmark.svg"
            alt={siteConfig.name}
            width={108}
            height={28}
            className="h-7 w-auto"
          />
        </Link>

        {signedIn ? (
          <AccountMenu
            profile={profile}
            hasServingAccess={hasServingAccess}
            isPlatformAdmin={isPlatformAdmin}
            orgName={orgName}
          />
        ) : (
          pathname !== "/login" && (
            <Button
              size="lg"
              className="px-6 text-lg font-semibold"
              nativeButton={false}
              render={<Link href="/login" />}
            >
              Sign in
            </Button>
          )
        )}
      </div>
    </header>
  );
}
