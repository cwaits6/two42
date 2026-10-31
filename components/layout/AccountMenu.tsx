"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { LogOut, Menu } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { createClient } from "@/lib/supabase/client";
import { failureMessage } from "@/lib/errorCopy";
import type { Profile } from "@/lib/types";
import { isMemberRole } from "@/lib/roles";
import { AreaNav, areaFor } from "./AreaNav";
import { isSidebarRoute } from "./AppShell";
import { INFO_LINKS } from "./infoLinks";
import { SidebarNav } from "./SidebarNav";
import { useSidebarModel } from "./useSidebarModel";

export interface AccountMenuProps {
  profile: Profile | null;
  hasServingAccess: boolean;
  isPlatformAdmin: boolean;
  orgName: string;
}

/** The one menu every signed-in person gets: the page nav on phone, then the account links and Sign out. */
export function AccountMenu(props: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  // Safety net: close the menu whenever the route changes.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const signOut = async () => {
    setOpen(false);
    const { error } = await createClient().auth.signOut();
    if (error) {
      toast.error(failureMessage("sign out"));
      return;
    }
    router.push("/");
    router.refresh();
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={<Button variant="ghost" size="lg" aria-expanded={open} className="gap-2 text-foreground" />}
      >
        <Menu className="h-6 w-6" aria-hidden="true" />
        Menu
      </SheetTrigger>
      <SheetContent side="right" className="w-[300px] overflow-y-auto">
        <SheetTitle className="sr-only">Menu</SheetTitle>
        <AccountMenuPanel {...props} onNavigate={() => setOpen(false)} onSignOut={signOut} />
      </SheetContent>
    </Sheet>
  );
}

export function AccountMenuPanel({
  profile,
  hasServingAccess,
  isPlatformAdmin,
  orgName,
  onNavigate,
  onSignOut,
}: AccountMenuProps & { onNavigate: () => void; onSignOut: () => void }) {
  const pathname = usePathname();
  const area = areaFor(pathname);
  const member = profile && isMemberRole(profile.role) ? profile : null;

  // Desktop shows the page nav in the sidebar wherever there is one.
  const pageNav = area ? (
    <AreaNav area={area} onNavigate={onNavigate} />
  ) : member ? (
    <MemberNav profile={member} hasServingAccess={hasServingAccess} orgName={orgName} onNavigate={onNavigate} />
  ) : null;
  const sidebarOnDesktop = area !== null || isSidebarRoute(pathname);

  const linkClass =
    "flex min-h-11 items-center rounded-lg px-3 text-base font-medium text-muted-foreground hover:bg-brand-warm/50 hover:text-brand-primary-text";

  return (
    <div className="flex min-h-full flex-col p-4 pt-14">
      {pageNav && (
        <div className={`mb-4 border-b border-border pb-4 ${sidebarOnDesktop ? "md:hidden" : ""}`}>
          {pageNav}
        </div>
      )}
      <nav aria-label="Account" className="space-y-1">
        {isPlatformAdmin && (
          <Link href="/platform" onClick={onNavigate} className={linkClass}>
            Platform
          </Link>
        )}
        {INFO_LINKS.map((link) => (
          <Link key={link.href} href={link.href} onClick={onNavigate} className={linkClass}>
            {link.label}
          </Link>
        ))}
      </nav>
      <Button variant="outline" size="lg" onClick={onSignOut} className="mt-4 w-full">
        <LogOut className="mr-2 h-5 w-5" aria-hidden="true" />
        Sign out
      </Button>
    </div>
  );
}

function MemberNav({
  profile,
  hasServingAccess,
  orgName,
  onNavigate,
}: {
  profile: Profile;
  hasServingAccess: boolean;
  orgName: string;
  onNavigate: () => void;
}) {
  const model = useSidebarModel({ profile, hasServingAccess, orgName, collapsed: false, phone: true });
  return (
    <nav aria-label="Main navigation" className="flex flex-col space-y-1">
      <SidebarNav model={model} onNavigate={onNavigate} />
    </nav>
  );
}
