"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronsUpDown, LogOut } from "lucide-react";
import { Fragment } from "react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { failureMessage } from "@/lib/errorCopy";
import { createClient } from "@/lib/supabase/client";
import type { Account } from "./account";

/**
 * Who is signed in, at the foot of the frame, and the one account menu. The
 * collapsed sidebar shows the photo or initials alone.
 */
export function AccountBlock({
  account,
  collapsed = false,
  onNavigate,
}: {
  account: Account;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const router = useRouter();

  const signOut = async () => {
    onNavigate?.();
    const { error } = await createClient().auth.signOut();
    if (error) {
      toast.error(failureMessage("sign out"));
      return;
    }
    router.push("/");
    router.refresh();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Account menu. Signed in as ${account.name}`}
        title={collapsed ? account.name : undefined}
        render={
          <button
            type="button"
            className={`flex items-center rounded-lg text-left transition-colors hover:bg-brand-warm/50 focus-visible:bg-brand-warm/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary ${
              collapsed ? "mx-auto h-11 w-11 justify-center" : "min-h-14 w-full gap-3 px-3 py-2"
            }`}
          />
        }
      >
        <Avatar className="size-10">
          {account.photoUrl && <AvatarImage src={account.photoUrl} alt="" />}
          <AvatarFallback className="bg-brand-primary text-sm font-semibold text-white">
            {account.initials}
          </AvatarFallback>
        </Avatar>
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1 truncate text-base font-semibold text-foreground">
              {account.name}
            </span>
            <ChevronsUpDown className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side={collapsed ? "right" : "top"}
        align={collapsed ? "end" : "start"}
        sideOffset={collapsed ? 12 : 4}
        className="w-64 rounded-xl p-1.5"
      >
        {account.rows.map((row, i) => (
          <Fragment key={row.href}>
            {i > 0 && row.section !== account.rows[i - 1].section && <DropdownMenuSeparator />}
            <DropdownMenuItem
              className="rounded-lg px-2.5"
              render={<Link href={row.href} onClick={onNavigate} />}
            >
              {row.label}
            </DropdownMenuItem>
          </Fragment>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="gap-2 rounded-lg px-2.5" onClick={signOut}>
          <LogOut className="h-5 w-5" aria-hidden="true" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
