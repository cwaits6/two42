"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { groupPath } from "@/lib/groups/active";
import { inviteJoinErrorMessage } from "@/lib/groups/invites";
import { createClient } from "@/lib/supabase/client";

interface JoinGroupButtonProps {
  token: string;
  groupId: string;
  groupName: string;
}

export function JoinGroupButton({ token, groupId, groupName }: JoinGroupButtonProps) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [busy, setBusy] = useState(false);
  const [requested, setRequested] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function join() {
    setBusy(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc("group_invite_join", { _token: token });
    setBusy(false);
    if (rpcError) {
      setError(inviteJoinErrorMessage(rpcError.code));
      return;
    }
    if (data === "requested") {
      setRequested(true);
      return;
    }
    if (data === "joined") toast.success(`You joined ${groupName}.`);
    router.replace(groupPath(groupId, "/dashboard"));
    router.refresh();
  }

  if (requested) {
    return (
      <div className="space-y-4" role="status">
        <p className="text-lg text-foreground">
          Request sent. A leader of {groupName} will review it.
        </p>
        <Button
          size="lg"
          variant="outline"
          className="w-full font-semibold"
          nativeButton={false}
          render={<Link href="/dashboard" />}
        >
          Go to Home
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error ? (
        <p role="alert" className="text-base text-destructive">
          {error}
        </p>
      ) : null}
      <Button
        size="lg"
        className="w-full font-semibold"
        onClick={join}
        disabled={busy}
      >
        {busy ? "Joining…" : "Join group"}
      </Button>
    </div>
  );
}
