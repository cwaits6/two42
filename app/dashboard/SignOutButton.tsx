"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { failureMessage } from "@/lib/errorCopy";

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    const { error } = await createClient().auth.signOut();
    if (error) {
      setBusy(false);
      toast.error(failureMessage("sign out"));
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <Button variant="outline" size="lg" onClick={signOut} disabled={busy}>
      <LogOut aria-hidden="true" />
      {busy ? "Signing out…" : "Sign out"}
    </Button>
  );
}
