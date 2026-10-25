"use client";

import Link from "next/link";
import { Collapsible } from "@base-ui/react/collapsible";
import { ChevronDown } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// The invite link is a URL the member already holds, so the secondary
// action explains where to find it instead of navigating anywhere.
export function MemberActions() {
  return (
    <Collapsible.Root className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-4">
        <Button
          size="lg"
          className="px-7 text-lg font-semibold"
          nativeButton={false}
          render={<Link href="/login" />}
        >
          Sign in
        </Button>
        <Collapsible.Trigger
          className={cn(
            buttonVariants({ variant: "outline", size: "lg" }),
            "group border-2 border-foreground bg-transparent px-7 text-lg font-semibold",
          )}
        >
          Have an invite link? Open it
          <ChevronDown
            aria-hidden="true"
            className="transition-transform group-data-[panel-open]:rotate-180"
          />
        </Collapsible.Trigger>
      </div>
      <Collapsible.Panel keepMounted className="max-w-xl rounded-xl border border-border bg-background p-5 text-lg leading-relaxed">
        Open the link from the message your leader sent you. It takes you
        straight to your group&rsquo;s sign-up page.
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
