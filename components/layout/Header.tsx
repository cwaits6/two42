"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { Account } from "./account";
import { AccountBlock } from "./AccountBlock";
import { FrameNav } from "./FrameNav";
import { useSidebar } from "./SidebarContext";
import { Wordmark } from "./Wordmark";

/**
 * The top bar. Signed out it offers Sign in at every width. Signed in it is
 * the phone frame only: the wordmark and one Menu button, with the sidebar
 * taking over from md up.
 */
export function Header() {
  const { account } = useSidebar();
  const [scrolled, setScrolled] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 12);
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  return (
    <header
      // Signed in, the bar sits above the drawer's overlay (z-50) so it shows
      // whether the drawer is open or closed.
      className={`sticky top-0 w-full border-b border-border transition-all duration-300 ${
        account ? "z-[60] md:hidden" : "z-50"
      } ${scrolled ? "bg-background/95 backdrop-blur shadow-sm" : "bg-background"}`}
    >
      {/* Top accent bar */}
      <div className="h-1 w-full bg-gradient-to-r from-brand-primary-light via-brand-primary to-brand-accent" />

      <div className="flex h-16 w-full items-center justify-between px-4">
        <Wordmark href={account ? account.homeHref : "/"} />

        {account ? (
          <MenuDrawer account={account} />
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

function MenuDrawer({ account }: { account: Account }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const close = () => setOpen(false);

  // Safety net: close the drawer whenever the route changes.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={<Button variant="ghost" size="lg" aria-expanded={open} className="gap-2 text-foreground" />}
      >
        <Menu className="h-6 w-6" aria-hidden="true" />
        Menu
      </SheetTrigger>
      {/* The bar covers the drawer's top edge, so the built-in close button would sit under it. */}
      <SheetContent side="right" showCloseButton={false} className="w-[300px] gap-0 pt-[4.25rem]">
        <SheetTitle className="sr-only">Menu</SheetTitle>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <FrameNav account={account} onNavigate={close} />
        </div>
        <div className="border-t border-border p-2">
          <AccountBlock account={account} onNavigate={close} />
        </div>
        <SheetClose className="sr-only">Close menu</SheetClose>
      </SheetContent>
    </Sheet>
  );
}
