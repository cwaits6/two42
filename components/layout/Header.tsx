"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { Menu, X, LogOut, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { siteConfig } from "@/lib/config";
import { createClient } from "@/lib/supabase/client";
import { usePathname, useRouter } from "next/navigation";
import { SidebarNav } from "./SidebarNav";
import { isSidebarRoute } from "./AppShell";
import { useSidebarModel } from "./useSidebarModel";
import type { Profile } from "@/lib/types";

interface HeaderProps {
  profile: Profile | null;
  hasServingAccess: boolean;
  isPlatformAdmin?: boolean;
  orgName: string;
}

export function Header({ profile, hasServingAccess, isPlatformAdmin = false, orgName }: HeaderProps) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 12);
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  // Safety net: close the drawer whenever the route changes.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const handleSignOut = async () => {
    setOpen(false);
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast.error("Sign out failed — please try again.");
      return;
    }
    router.push("/");
    router.refresh();
  };

  const isAdmin = profile?.role === "admin";
  const isMember =
    profile?.role === "member" || profile?.role === "content_editor" || isAdmin;

  // The desktop sidebar pane is only rendered on these routes; elsewhere
  // (e.g. /household) the menu button stays available at all breakpoints.
  const hasDesktopSidebar = isMember && isSidebarRoute(pathname);

  // The admin area supplies its own nav (AdminSidebarNav: a persistent rail on
  // desktop, a horizontal bar on mobile) plus a "Back to app" link. Swap, don't
  // stack: suppress the member-nav drawer here so admin has one nav system.
  // /platform is the same deal — a platform admin who also has a member
  // profile would otherwise get the member drawer stacked on the platform nav.
  const isAdminArea =
    pathname.startsWith("/admin") || pathname.startsWith("/platform");

  return (
    <header
      className={`sticky top-0 z-50 w-full border-b border-border transition-all duration-300 ${
        scrolled ? "bg-white/95 backdrop-blur shadow-sm" : "bg-white"
      }`}
    >
      {/* Top accent bar */}
      <div className="h-1 w-full bg-gradient-to-r from-brand-primary-light via-brand-primary to-brand-accent" />

      <div className="flex h-16 w-full items-center justify-between px-4">
        <div className="flex items-center gap-1">
          {/* Mobile (or no sidebar): the nav drawer. Hidden in the admin
              area, which supplies its own nav. */}
          {profile && isMember && !isAdminArea && (
            <NavDrawer
              profile={profile}
              hasServingAccess={hasServingAccess}
              orgName={orgName}
              open={open}
              onOpenChange={setOpen}
              hideOnDesktop={hasDesktopSidebar}
              onSignOut={handleSignOut}
            />
          )}

          <Link
            href={isMember ? "/dashboard" : "/"}
            className="flex items-center group"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/two42-wordmark.svg"
              alt={siteConfig.name}
              className="h-7 w-auto"
            />
          </Link>
        </div>

        <div className="flex items-center gap-2">
          {isPlatformAdmin && (
            <Button
              variant="ghost"
              size="lg"
              className="text-base text-slate-600 hover:text-brand-primary"
              nativeButton={false}
              render={<Link href="/platform" />}
            >
              Platform
            </Button>
          )}
          {profile ? (
            <Button
              variant="outline"
              size="lg"
              onClick={handleSignOut}
              className={`text-base border-slate-200 hover:border-destructive/30 hover:text-destructive hover:bg-destructive/10 ${
                isMember && !isAdminArea ? "hidden md:inline-flex" : ""
              }`}
            >
              <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
              Sign Out
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="lg"
              className="text-base text-slate-600 hover:text-brand-primary"
              nativeButton={false}
              render={<Link href="/login" />}
            >
              Sign In
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}

function NavDrawer({
  profile,
  hasServingAccess,
  orgName,
  open,
  onOpenChange,
  hideOnDesktop,
  onSignOut,
}: {
  profile: Profile;
  hasServingAccess: boolean;
  orgName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hideOnDesktop: boolean;
  onSignOut: () => void;
}) {
  const model = useSidebarModel({
    profile,
    hasServingAccess,
    orgName,
    collapsed: false,
    phone: true,
  });
  const pill = model.phonePill;
  const triggerLabel = open
    ? "Close navigation menu"
    : pill
      ? `Open navigation menu for ${pill.group.name}`
      : "Open navigation menu";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger
        render={
          pill ? (
            <Button
              variant="outline"
              aria-label={triggerLabel}
              aria-expanded={open}
              className={`h-11 max-w-[60vw] gap-2 rounded-full border-slate-200 px-3 text-slate-700 ${
                hideOnDesktop ? "md:hidden" : ""
              }`}
            />
          ) : (
            <Button
              variant="ghost"
              size="icon"
              aria-label={triggerLabel}
              aria-expanded={open}
              className={`text-slate-700 ${hideOnDesktop ? "md:hidden" : ""}`}
            />
          )
        }
      >
        {pill ? (
          <>
            <span
              aria-hidden="true"
              className="h-3 w-3 shrink-0 rounded-full"
              style={{ background: pill.group.color }}
            />
            <span className="truncate text-base font-semibold">{pill.group.name}</span>
            <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
          </>
        ) : open ? (
          <X className="h-6 w-6" aria-hidden="true" />
        ) : (
          <Menu className="h-6 w-6" aria-hidden="true" />
        )}
      </SheetTrigger>
      <SheetContent
        side="left"
        className="w-[300px] border-r border-border overflow-y-auto"
      >
        <SheetTitle className="sr-only">Navigation menu</SheetTitle>
        <div className="flex flex-col h-full p-4">
          <div className="flex items-center mb-6 mt-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/two42-wordmark.svg"
              alt={siteConfig.name}
              className="h-7 w-auto"
            />
          </div>
          <nav
            aria-label="Main navigation"
            className="flex min-h-0 flex-1 flex-col space-y-1"
          >
            <SidebarNav model={model} onNavigate={() => onOpenChange(false)} />
          </nav>
          <div className="border-t border-border pt-4 mt-4">
            <Button
              variant="outline"
              size="lg"
              onClick={onSignOut}
              className="w-full"
            >
              <LogOut className="mr-2 h-5 w-5" aria-hidden="true" />
              Sign Out
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
