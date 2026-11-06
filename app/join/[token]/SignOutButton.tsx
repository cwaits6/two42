"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { signOutHere } from "@/lib/signOut";

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    const outcome = await signOutHere();
    setBusy(false);
    if (outcome.message) toast.error(outcome.message);
    if (outcome.signedOut) router.refresh();
  }

  return (
    <Button size="lg" variant="outline" className="w-full" onClick={signOut} disabled={busy}>
      {busy ? "Signing out…" : "Sign out"}
    </Button>
  );
}
