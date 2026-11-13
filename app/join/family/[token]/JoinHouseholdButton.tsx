"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { failureMessage } from "@/lib/errorCopy";
import { HOUSEHOLD_INVITE_INVALID_TEXT } from "@/lib/groups/invites";
import { HOUSEHOLD_TAB } from "@/lib/profileTabs";

const ACTION = "join this household";
const KNOWN = {
  403: "This invite was sent to a different email address. Sign out, then open the link again with that account.",
  404: HOUSEHOLD_INVITE_INVALID_TEXT,
  409: "You're already in a household. Ask a church admin to move you.",
};

interface JoinHouseholdButtonProps {
  token: string;
  familyName: string;
}

export function JoinHouseholdButton({ token, familyName }: JoinHouseholdButtonProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function join() {
    setBusy(true);
    setError(null);
    let res: Response;
    try {
      res = await fetch("/api/family-invites/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
    } catch {
      setBusy(false);
      setError(failureMessage(ACTION, "network"));
      return;
    }
    if (!res.ok) {
      setBusy(false);
      setError(failureMessage(ACTION, res.status, KNOWN));
      return;
    }
    toast.success(`You joined the ${familyName} household.`);
    router.replace(`/profile?tab=${HOUSEHOLD_TAB}`);
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {error ? (
        <p role="alert" className="text-base text-destructive">
          {error}
        </p>
      ) : null}
      <Button size="lg" className="w-full font-semibold" onClick={join} disabled={busy}>
        {busy ? "Joining…" : "Join household"}
      </Button>
      <Button
        size="lg"
        variant="outline"
        className="w-full font-semibold"
        nativeButton={false}
        render={<Link href="/dashboard" />}
      >
        Cancel
      </Button>
    </div>
  );
}
