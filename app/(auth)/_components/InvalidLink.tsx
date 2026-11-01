import Link from "next/link";
import { Button } from "@/components/ui/button";
import { INVITE_INVALID_TITLE } from "@/lib/groups/invites";
import { AuthShell } from "./AuthShell";

/**
 * The one dead-link card for invite and signup links. It reads the same
 * whatever made the link dead; `help` names who to ask for a new one.
 */
export function InvalidLink({ eyebrow, help }: { eyebrow?: string; help: string }) {
  return (
    <AuthShell
      eyebrow={eyebrow}
      title={INVITE_INVALID_TITLE}
      kicker={help}
      altPrompt="Already have an account?"
      altLabel="Sign in"
      altHref="/login"
    >
      <Button
        size="lg"
        variant="outline"
        className="w-full font-semibold"
        nativeButton={false}
        render={<Link href="/" />}
      >
        Go to Home
      </Button>
    </AuthShell>
  );
}
